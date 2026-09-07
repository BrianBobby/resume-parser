require("dotenv").config();
const path = require("path");
const express = require("express");
const multer = require("multer");
const { extractResumeData } = require("./lib/extractResume");
const { buildResumeXml, safeFilename } = require("./lib/buildResumeXml");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".txt",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Unsupported file type "${ext}". Try a PDF, Word doc, or image.`,
        ),
      );
    }
  },
});

app.get("/", (req, res) => {
  res.render("index", { error: null });
});

app.post("/upload", (req, res) => {
  upload.single("resume")(req, res, async (err) => {
    if (err) {
      return res.render("index", { error: err.message });
    }
    if (!req.file) {
      return res.render("index", { error: "Please choose a file to upload." });
    }

    try {
      const data = await extractResumeData(
        req.file.buffer,
        req.file.originalname,
      );
      const xml = buildResumeXml(data);
      res.render("result", { data, xml, filename: req.file.originalname });
    } catch (extractionError) {
      console.error(extractionError);
      res.render("index", {
        error: `Couldn't read that resume: ${extractionError.message}`,
      });
    }
  });
});

app.post("/api/parse-resume", (req, res) => {
  upload.single("resume")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res
        .status(400)
        .json({ error: 'Attach a file under the "resume" field.' });
    }

    try {
      const data = await extractResumeData(
        req.file.buffer,
        req.file.originalname,
      );

      if (req.query.format === "json") {
        return res.status(200).json(data);
      }

      const xml = buildResumeXml(data);
      const filename = `${safeFilename(data)}.xml`;
      res
        .status(200)
        .type("application/xml")
        .set("Content-Disposition", `attachment; filename="${filename}"`)
        .send(xml);
    } catch (extractionError) {
      console.error(extractionError);
      res.status(422).json({
        error: `Couldn't read that resume: ${extractionError.message}`,
      });
    }
  });
});

app.listen(PORT, () => {
  console.log(`Resume parser running at http://localhost:${PORT}`);
});
