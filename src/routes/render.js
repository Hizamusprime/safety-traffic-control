import express from "express";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { createClient } from "@supabase/supabase-js";
import Handlebars from "handlebars";


const router = express.Router();
const execAsync = promisify(exec);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.use((req, res, next) => {
  const key = req.headers["x-api-key"];
  if (!process.env.RENDER_API_KEY || key !== process.env.RENDER_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

router.post("/html", async (req, res) => {
  try {
    const { template, version, job_id, data } = req.body || {};
    if (!template || !version || !job_id || !data) {
      return res.status(400).json({ error: "Missing: template, version, job_id, data" });
    }

    const TEMPLATE_BUCKET = process.env.TEMPLATE_BUCKET || "templates";
    const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET || "outputs";

    const tempDir = path.join(process.cwd(), "temp");
    ensureDir(tempDir);

    const base = `${job_id}-${template}-${version}`;
    const localDocx = path.join(tempDir, `${base}.docx`);
    const localPdf  = path.join(tempDir, `${base}.pdf`);

    // Download template DOCX
    const templateKey = `${template}/${version}/${template}.docx`;
    const { data: dl, error: dlErr } = await supabase.storage
      .from(TEMPLATE_BUCKET)
      .download(templateKey);

    if (dlErr) throw new Error(`Template download failed: ${dlErr.message}`);
    fs.writeFileSync(localDocx, Buffer.from(await dl.arrayBuffer()));

    // Fill template
    const content = fs.readFileSync(localDocx, "binary");
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.setData(data);
    doc.render();
    fs.writeFileSync(localDocx, doc.getZip().generate({ type: "nodebuffer" }));

    // Convert DOCX -> PDF
    await execAsync(`libreoffice --headless --convert-to pdf --outdir "${tempDir}" "${localDocx}"`);
    if (!fs.existsSync(localPdf)) throw new Error("PDF conversion failed (no pdf produced)");

    // Upload PDF
    const outputKey = `${job_id}/${template}/${template}-${version}.pdf`;
    const pdfBuffer = fs.readFileSync(localPdf);

    const { error: upErr } = await supabase.storage
      .from(OUTPUT_BUCKET)
      .upload(outputKey, pdfBuffer, { contentType: "application/pdf", upsert: true });

    if (upErr) throw new Error(`PDF upload failed: ${upErr.message}`);

    // cleanup
    try { fs.unlinkSync(localDocx); } catch {}
    try { fs.unlinkSync(localPdf); } catch {}

    return res.json({ success: true, output_bucket: OUTPUT_BUCKET, output_key: outputKey });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || String(e) });
  }


router.post("/html", async (req, res) => {
  try {
    const { template, version, job_id, data } = req.body || {};
    if (!template || !version || !job_id || !data) {
      return res.status(400).json({ error: "Missing: template, version, job_id, data" });
    }

    const TEMPLATE_BUCKET = process.env.TEMPLATE_BUCKET || "templates";
    const templateKey = `${template}/${version}/${template}.html`;

    const { data: dl, error: dlErr } = await supabase.storage
      .from(TEMPLATE_BUCKET)
      .download(templateKey);

    if (dlErr) throw new Error(`Template download failed: ${dlErr.message}`);

    const html = Buffer.from(await dl.arrayBuffer()).toString("utf8");
    const compiled = Handlebars.compile(html);
    const outputHtml = compiled({ ...data, job_id });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(outputHtml);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || String(e) });
  }
});

export default router;
