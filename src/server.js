import "dotenv/config";
import express from "express";
import renderRoute from "./routes/render.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/render", renderRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
