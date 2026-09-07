const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const mammoth = require("mammoth");
const { XMLParser } = require("fast-xml-parser");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-terra";

const IMAGE_MEDIA_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const TEXT_EXTRACTABLE_EXTS = new Set([".docx", ".txt"]);

const FILE_MEDIA_TYPES = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
};

const REPEATING_TAGS = new Set(["item", "link"]);

const XML_SHAPE = `<resume>
  <name>Full name, omit tag if not found</name>
  <address>
    <address1>Street address, omit tag if not found</address1>
    <address2>City/region, omit tag if not found</address2>
    <address3>Country, omit tag if not found</address3>
  </address>
  <email>omit tag if not found</email>
  <mobile>omit tag if not found</mobile>
  <passportNo>omit tag if not found</passportNo>
  <passportExpDt>omit tag if not found</passportExpDt>
  <visaStatus>omit tag if not found</visaStatus>
  <links>
    <link><label>e.g. LinkedIn, GitHub, Portfolio, Twitter</label><url></url></link>
  </links>
  <education>
    <item>
      <description>concise summary of majors/coursework/thesis, at most 3 short points joined with "; ", omit tag if nothing worth saying</description>
      <board>institution/university name</board>
      <country>omit tag if not found</country>
      <year>e.g. "2019 - 2022", omit tag if not found</year>
    </item>
  </education>
  <certifications>
    <item>
      <description>concise summary, at most 3 short points joined with "; ", omit tag if nothing worth saying</description>
      <board>certifying body/issuer</board>
      <country>omit tag if not found</country>
      <year>omit tag if not found</year>
    </item>
  </certifications>
  <achievements>
    <item>
      <description>concise summary, at most 3 short points joined with "; ", omit tag if nothing worth saying</description>
      <board>awarding body, omit tag if not found</board>
      <country>omit tag if not found</country>
      <year>omit tag if not found</year>
    </item>
  </achievements>
  <experience>
    <item>
      <company></company>
      <designation></designation>
      <periodFrom></periodFrom>
      <periodTo></periodTo>
      <country>omit tag if not found</country>
      <state>omit tag if not found</state>
      <responsibility>
        <item>one short, concrete responsibility or achievement, under 12 words</item>
      </responsibility>
    </item>
  </experience>
</resume>`;

const EXTRACTION_PROMPT = `You are a resume-parsing assistant. Read the resume carefully (as text, image, or file, whichever is attached) and respond with ONLY a well-formed XML document in exactly this shape:

${XML_SHAPE}

Classification rules:
- "education" covers degrees, diplomas, and coursework from schools/universities.
- "certifications" covers professional certifications and licenses only (e.g. issued by a certifying body, with a credential/issuer).
- "achievements" covers awards, honors, publications, and other notable accomplishments that are NOT certifications or licenses. Keep these two lists strictly separate — do not duplicate an entry in both.
- "experience" covers ALL work history — full-time, part-time, contract, freelance, AND internships/co-ops alike. Do not separate internships out; just include them as items here, with "designation" reflecting the actual title (e.g. "Marketing Intern").
- "links" covers URLs or handles for professional/social profiles mentioned on the resume (LinkedIn, GitHub, personal site/portfolio, Twitter/X, Behance, etc). Use a short, recognizable label for each. Omit anything not explicitly present.
- "passportNo", "passportExpDt", and "visaStatus" are only present on resumes aimed at overseas/visa-sponsored employment; omit them if the resume doesn't mention them. Never infer or guess a passport number.
- "country" (education/certifications/achievements/experience) and "state" (experience) are the location associated with that specific institution/employer, not the candidate's home address. Omit if not stated or not inferable.
- If a field is missing from the resume, omit its tag entirely (or leave a list container empty, e.g. <education></education>) — never invent information, and never write "not found", "null", or "N/A" as text content.
- Dates/years can be left as they appear on the resume (e.g. "Jun 2021", "2019 - Present").
- For "responsibility" (experience): include at most 3 <item> elements, ranked by importance/impact, each a short concrete phrase under 12 words. Omit the whole tag if there's nothing worth saying.
- For "description" (education/certifications/achievements): at most 3 short points joined into ONE string with "; " between them (not separate tags) — ranked by importance, filler words removed. Omit the tag entirely if there's nothing worth saying.
- Escape any &, <, or > characters that appear inside text content so the XML stays well-formed.
- Return ONLY the XML document and nothing else — no markdown code fences, no commentary, no XML declaration needed.`;

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  parseTagValue: false,
  isArray: (tagName) => REPEATING_TAGS.has(tagName),
});

function getExtension(filename) {
  return path.extname(filename || "").toLowerCase();
}

function stripToXml(rawText) {
  const cleaned = rawText
    .replace(/```xml/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("<");
  const end = cleaned.lastIndexOf(">");
  if (start === -1 || end === -1) {
    throw new Error("AI response did not contain an XML document.");
  }
  return cleaned.slice(start, end + 1);
}

function cleanText(val) {
  if (val === null || val === undefined) return null;
  const text = String(val).trim();
  if (!text) return null;
  if (/^(null|n\/a|na|not found|none|unknown)$/i.test(text)) return null;
  return text;
}

function toArray(val) {
  if (Array.isArray(val)) return val;
  if (val === null || val === undefined || val === "") return [];
  return [val];
}

function cleanList(container, key, limit) {
  if (!container) return [];
  const list = toArray(container[key]).map(cleanText).filter(Boolean);
  return typeof limit === "number" ? list.slice(0, limit) : list;
}

function normalizeRecordList(list) {
  return toArray(list)
    .map((item) => ({
      description: cleanText(item.description),
      board: cleanText(item.board),
      country: cleanText(item.country),
      year: cleanText(item.year),
    }))
    .filter(
      (item) => item.description || item.board || item.country || item.year,
    );
}

function normalize(raw) {
  const root = raw.resume || {};

  const links = toArray(root.links && root.links.link).reduce((acc, link) => {
    const url = cleanText(link && link.url);
    if (!url) return acc;
    acc.push({ label: cleanText(link.label) || "Link", url });
    return acc;
  }, []);

  const addressBlock = root.address || {};
  const address = {
    address1: cleanText(addressBlock.address1),
    address2: cleanText(addressBlock.address2),
    address3: cleanText(addressBlock.address3),
  };

  const experience = toArray(root.experience && root.experience.item)
    .map((item) => ({
      company: cleanText(item.company),
      designation: cleanText(item.designation),
      periodFrom: cleanText(item.periodFrom),
      periodTo: cleanText(item.periodTo),
      country: cleanText(item.country),
      state: cleanText(item.state),
      responsibility: cleanList(item.responsibility, "item", 3),
    }))
    .filter(
      (item) => item.company || item.designation || item.responsibility.length,
    );

  return {
    name: cleanText(root.name),
    address,
    email: cleanText(root.email),
    mobile: cleanText(root.mobile),
    passportNo: cleanText(root.passportNo),
    passportExpDt: cleanText(root.passportExpDt),
    visaStatus: cleanText(root.visaStatus),
    links,
    education: normalizeRecordList(root.education && root.education.item),
    certifications: normalizeRecordList(
      root.certifications && root.certifications.item,
    ),
    achievements: normalizeRecordList(
      root.achievements && root.achievements.item,
    ),
    experience,
  };
}

/**
 * Extract plain text locally from a .docx or .txt buffer.
 * @param {Buffer} buffer
 * @param {string} ext - lowercased file extension, e.g. ".docx"
 * @returns {Promise<string>}
 */
async function extractLocalText(buffer, ext) {
  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ buffer });
    const text = (value || "").trim();
    if (!text) {
      throw new Error("Could not extract any text from the .docx file.");
    }
    return text;
  }

  if (ext === ".txt") {
    const text = buffer.toString("utf-8").trim();
    if (!text) {
      throw new Error("The .txt file appears to be empty.");
    }
    return text;
  }

  throw new Error(`extractLocalText called with unsupported extension: ${ext}`);
}

/**
 * @param {Buffer} buffer - raw file bytes
 * @param {string} originalname - original uploaded filename (used to detect type)
 * @returns {Promise<object>} parsed resume data
 */
async function extractResumeData(buffer, originalname) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set. Add it to your .env file.");
  }

  const ext = getExtension(originalname);
  let userContent;

  if (IMAGE_MEDIA_TYPES[ext]) {
    const dataUrl = `data:${IMAGE_MEDIA_TYPES[ext]};base64,${buffer.toString("base64")}`;
    userContent = [
      { type: "text", text: EXTRACTION_PROMPT },
      { type: "image_url", image_url: { url: dataUrl } },
    ];
  } else if (TEXT_EXTRACTABLE_EXTS.has(ext)) {
    const extractedText = await extractLocalText(buffer, ext);
    userContent = [
      {
        type: "text",
        text: `${EXTRACTION_PROMPT}\n\n--- RESUME TEXT START ---\n${extractedText}\n--- RESUME TEXT END ---`,
      },
    ];
  } else {
    const mimeType = FILE_MEDIA_TYPES[ext] || "application/octet-stream";
    const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
    userContent = [
      { type: "text", text: EXTRACTION_PROMPT },
      {
        type: "file",
        file: {
          filename: originalname || `resume${ext || ""}`,
          file_data: dataUrl,
        },
      },
    ];
  }

  const response = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 2000,
    messages: [{ role: "user", content: userContent }],
  });

  const raw = response.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error("The AI model did not return a text response.");
  }

  const xml = stripToXml(raw);
  let parsed;
  try {
    parsed = xmlParser.parse(xml);
  } catch (err) {
    throw new Error(`AI response was not valid XML: ${err.message}`);
  }

  return normalize(parsed);
}

module.exports = { extractResumeData };
