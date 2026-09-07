function esc(val) {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tag(name, value, indent) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";
  return `${indent}<${name}>${esc(text)}</${name}>\n`;
}

function buildAddressXml(address) {
  if (!address) return "";
  const body =
    tag("address1", address.address1, "\t\t") +
    tag("address2", address.address2, "\t\t") +
    tag("address3", address.address3, "\t\t");
  if (!body) return "";
  return `\t<address>\n${body}\t</address>\n`;
}

function buildRecordListXml(tagName, list) {
  if (!list || !list.length) return "";
  let xml = `\t<${tagName}>\n`;
  list.forEach((record) => {
    const body =
      tag("description", record.description, "\t\t\t") +
      tag("board", record.board, "\t\t\t") +
      tag("country", record.country, "\t\t\t") +
      tag("year", record.year, "\t\t\t");
    if (!body) return;
    xml += `\t\t<item>\n${body}\t\t</item>\n`;
  });
  xml += `\t</${tagName}>\n`;
  return xml;
}

function buildExperienceXml(list) {
  if (!list || !list.length) return "";
  let xml = "\t<experience>\n";
  list.forEach((role) => {
    let body =
      tag("company", role.company, "\t\t\t") +
      tag("designation", role.designation, "\t\t\t") +
      tag("periodFrom", role.periodFrom, "\t\t\t") +
      tag("periodTo", role.periodTo, "\t\t\t") +
      tag("country", role.country, "\t\t\t") +
      tag("state", role.state, "\t\t\t");
    if (role.responsibility && role.responsibility.length) {
      body += "\t\t\t<responsibility>\n";
      role.responsibility.forEach((point) => {
        body += tag("item", point, "\t\t\t\t");
      });
      body += "\t\t\t</responsibility>\n";
    }
    if (!body) return;
    xml += `\t\t<item>\n${body}\t\t</item>\n`;
  });
  xml += "\t</experience>\n";
  return xml;
}

/**
 * @param {object} data - parsed resume data (as returned by extractResumeData)
 * @returns {string} XML document
 */
function buildResumeXml(data) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<resume>\n';
  xml += tag("name", data.name, "\t");
  xml += buildAddressXml(data.address);
  xml += tag("email", data.email, "\t");
  xml += tag("mobile", data.mobile, "\t");
  xml += tag("passportNo", data.passportNo, "\t");
  xml += tag("passportExpDt", data.passportExpDt, "\t");
  xml += tag("visaStatus", data.visaStatus, "\t");
  xml += buildRecordListXml("education", data.education);
  xml += buildRecordListXml("certifications", data.certifications);
  xml += buildExperienceXml(data.experience);
  xml += "</resume>\n";
  return xml;
}

function safeFilename(data) {
  const name = (data.name || "resume")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return name || "resume";
}

module.exports = { buildResumeXml, safeFilename };
