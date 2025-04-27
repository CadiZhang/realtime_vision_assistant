import express from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";
import "dotenv/config";
import fetch from "node-fetch";
import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp"; // We'll use sharp for image processing
import { createWriteStream } from "fs";
import { promisify } from "util";
import { unlink } from "fs";

const unlinkAsync = promisify(unlink);
const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.OPENAI_API_KEY;

// Configure Vite middleware for React client
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "custom",
});
app.use(vite.middlewares);

// Enable JSON body parsing
app.use(express.json());

// API route for token generation
app.get("/token", async (req, res) => {
  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview-2024-12-17",
          voice: "verse",
        }),
      },
    );

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Token generation error:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

// Helper function to capture a frame from a video stream using ffmpeg
async function captureStreamFrame(url) {
  console.log("🎥 Capturing frame from stream:", url);
  
  // Create a temporary directory for screenshots if it doesn't exist
  const screenshotsDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
  
  // Generate a unique output file name
  const outputFile = path.join(screenshotsDir, `stream_frame_${Date.now()}.png`);
  
  return new Promise((resolve, reject) => {
    ffmpeg(url)
      .on('end', () => {
        console.log(`✅ Screenshot saved as ${outputFile}`);
        resolve(outputFile);
      })
      .on('error', (err) => {
        console.error(`❌ FFMPEG Error: ${err.message}`);
        reject(err);
      })
      .screenshots({
        timestamps: ['00:00:01.000'], // Capture a frame at 1 second
        filename: path.basename(outputFile),
        folder: path.dirname(outputFile),
        size: '640x360', // Adjust the screenshot size
      });
  });
}

// New endpoint to capture an image from the stream
app.post("/capture-image", async (req, res) => {
  console.log("📷 Received capture-image request:", req.body);
  
  try {
    const { cameraUrl, prompt } = req.body;
    
    if (!cameraUrl) {
      console.error("❌ Missing camera URL");
      return res.status(400).json({ error: "Camera URL is required" });
    }
    
    console.log("🔗 Using stream URL:", cameraUrl);
    console.log("💬 Using prompt:", prompt || "What's in this image?");
    
    // Capture a frame from the stream
    let outputFile;
    try {
      outputFile = await captureStreamFrame(cameraUrl);
      console.log("📸 Successfully captured frame to:", outputFile);
    } catch (error) {
      console.error("❌ Failed to capture stream frame:", error);
      return res.status(500).json({ error: `Failed to capture stream frame: ${error.message}` });
    }
    
    // Read the captured image
    const imageBuffer = fs.readFileSync(outputFile);
    console.log("📦 Received image buffer, size:", imageBuffer.length, "bytes");
    
    // Use sharp to resize and optimize the image if needed
    console.log("🖼️ Processing image with sharp");
    const processedImage = await sharp(imageBuffer)
      .resize(800) // Resize to max width of 800px while maintaining aspect ratio
      .jpeg({ quality: 80 }) // Convert to JPEG with 80% quality
      .toBuffer();
    
    console.log("✅ Image processed, new size:", processedImage.length, "bytes");
    
    // Convert to base64
    const base64Image = processedImage.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64Image}`;
    console.log("🔄 Converted image to base64, length:", base64Image.length);
    
    // Send the image to OpenAI vision model for analysis
    console.log("🧠 Sending image to OpenAI vision API");
    const visionResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o", // This model has vision capabilities
        messages: [
          {
            role: "user",
            content: [
              { 
                type: "text", 
                text: prompt || "Describe what's in this image clearly and conversationally and concisely, in a way that would sound natural if spoken aloud." 
              },
              {
                type: "image_url",
                image_url: {
                  url: dataUrl
                }
              }
            ]
          }
        ],
        max_tokens: 300
      })
    });
    
    console.log("📡 Vision API response status:", visionResponse.status);
    
    if (!visionResponse.ok) {
      const errorData = await visionResponse.json();
      console.error("❌ Vision API error:", errorData);
      throw new Error(`Vision API error: ${errorData.error?.message || visionResponse.statusText}`);
    }
    
    const visionData = await visionResponse.json();
    console.log("✅ Vision API success, data:", JSON.stringify(visionData).substring(0, 100) + "...");
    const analysis = visionData.choices[0].message.content;
    console.log("📝 Analysis:", analysis);
    
    // Clean up the temporary file
    try {
      await unlinkAsync(outputFile);
      console.log("🧹 Cleaned up temporary file:", outputFile);
    } catch (cleanupError) {
      console.warn("⚠️ Failed to clean up temporary file:", cleanupError);
    }
    
    // Return both the image and analysis
    console.log("🚀 Sending successful response");
    res.json({
      success: true,
      imageData: dataUrl,
      analysis: analysis
    });
    
  } catch (error) {
    console.error("❌ Image capture error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Render the React client
app.use("*", async (req, res, next) => {
  const url = req.originalUrl;

  try {
    const template = await vite.transformIndexHtml(
      url,
      fs.readFileSync("./client/index.html", "utf-8"),
    );
    const { render } = await vite.ssrLoadModule("./client/entry-server.jsx");
    const appHtml = await render(url);
    const html = template.replace(`<!--ssr-outlet-->`, appHtml?.html);
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  } catch (e) {
    vite.ssrFixStacktrace(e);
    next(e);
  }
});

app.listen(port, () => {
  console.log(`Express server running on *:${port}`);
});
