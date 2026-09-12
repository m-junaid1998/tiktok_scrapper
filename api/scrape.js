require("dotenv").config();

const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { v2: cloudinary } = require("cloudinary");


// ============================================================
// ACCOUNTS
// ============================================================

const ACCOUNTS = [
  "abeera_khan__",
  "faariafarooq7",
  "insharah_143",
  "ahmad___7_"
];


// ============================================================
// ENVIRONMENT CHECK
// ============================================================

const requiredEnv = [
  "RAPIDAPI_KEY",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY"
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
  }
}


// ============================================================
// SUPABASE
// ============================================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


// ============================================================
// CLOUDINARY
// ============================================================

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});


// ============================================================
// GET TIKTOK POSTS
// ============================================================

async function getTikTokPosts(username) {

  console.log(`Fetching TikTok posts for @${username}`);

  const response = await axios.get(
    "https://tiktok-scraper7.p.rapidapi.com/user/posts",
    {
      params: {
        unique_id: username,
        count: 35,
        cursor: 0
      },

      headers: {
        "x-rapidapi-key": process.env.RAPIDAPI_KEY,
        "x-rapidapi-host": "tiktok-scraper7.p.rapidapi.com"
      },

      timeout: 30000
    }
  );

  const videos = response.data?.data?.videos || [];

  console.log(
    `@${username}: ${videos.length} videos received`
  );

  return videos;
}


// ============================================================
// CHECK IF VIDEO EXISTS IN SUPABASE
// ============================================================

async function alreadyDownloaded(videoId) {

  const { data, error } = await supabase
    .from("tiktok_videos")
    .select("video_id")
    .eq("video_id", videoId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}


// ============================================================
// SAVE VIDEO TO SUPABASE
// ============================================================

async function saveVideo(
  videoId,
  username,
  cloudinaryUrl
) {

  const { error } = await supabase
    .from("tiktok_videos")
    .upsert(
      {
        video_id: videoId,
        username: username,
        cloudinary_url: cloudinaryUrl,
        uploaded_at: new Date().toISOString()
      },
      {
        onConflict: "video_id"
      }
    );

  if (error) {
    throw error;
  }

  console.log(
    `Database saved: ${videoId}`
  );
}


// ============================================================
// DOWNLOAD VIDEO
// ============================================================

async function downloadVideo(videoUrl) {

  console.log("Downloading video...");

  const response = await axios.get(
    videoUrl,
    {
      responseType: "arraybuffer",

      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",

        "Referer": "https://www.tiktok.com/",

        "Accept": "*/*"
      },

      timeout: 120000,

      maxContentLength:
        100 * 1024 * 1024,

      maxBodyLength:
        100 * 1024 * 1024
    }
  );

  console.log(
    `Downloaded ${(response.data.length / 1024 / 1024).toFixed(2)} MB`
  );

  return Buffer.from(response.data);
}


// ============================================================
// UPLOAD TO CLOUDINARY
// ============================================================

async function uploadToCloudinary(
  buffer,
  username,
  video
) {

  return new Promise((resolve, reject) => {

    const videoId = String(video.video_id);

    const caption = String(
      video.title || ""
    )
      .replace(/[|=]/g, " ")
      .replace(/[^\x20-\x7E]/g, "")
      .trim();


    const upload = cloudinary.uploader.upload_stream(
      {
        resource_type: "video",

        folder:
          `tiktok_backups/${username}`,

        public_id:
          `tiktok_backup_${videoId}`,

        overwrite: false,

        context: {
          tiktok_id: videoId,
          caption: caption
        }
      },

      (error, result) => {

        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );


    upload.end(buffer);

  });
}


// ============================================================
// PROCESS ONE ACCOUNT
// ============================================================

async function processAccount(username) {

  console.log("");
  console.log(
    "=========================================="
  );

  console.log(
    `Checking @${username}`
  );

  console.log(
    "=========================================="
  );


  let videos;

  try {

    videos = await getTikTokPosts(username);

  } catch (error) {

    console.error(
      `TikTok API error for @${username}`
    );

    console.error(
      error.response?.data || error.message
    );

    return {
      username,
      success: false,
      uploaded: 0,
      skipped: 0,
      failed: 1
    };
  }


  let uploaded = 0;
  let skipped = 0;
  let failed = 0;


  for (const video of videos) {

    const videoId =
      video?.video_id
        ? String(video.video_id)
        : null;


    // --------------------------------------------------------
    // Invalid video
    // --------------------------------------------------------

    if (!videoId) {

      console.log(
        "Skipping video because video_id is missing"
      );

      skipped++;

      continue;
    }


    try {

      // ------------------------------------------------------
      // DATABASE DUPLICATE CHECK
      // ------------------------------------------------------

      const exists =
        await alreadyDownloaded(videoId);


      if (exists) {

        console.log(
          `Already downloaded: ${videoId}`
        );

        skipped++;

        continue;
      }


      console.log("");
      console.log(
        `NEW VIDEO: ${videoId}`
      );


      // ------------------------------------------------------
      // VIDEO URL
      // ------------------------------------------------------

      const videoUrl =
        video.play ||
        video.download_addr ||
        video.download_url;


      if (!videoUrl) {

        console.log(
          `No download URL found for ${videoId}`
        );

        failed++;

        continue;
      }


      // ------------------------------------------------------
      // DOWNLOAD
      // ------------------------------------------------------

      const buffer =
        await downloadVideo(videoUrl);


      // ------------------------------------------------------
      // CLOUDINARY UPLOAD
      // ------------------------------------------------------

      console.log(
        "Uploading to Cloudinary..."
      );


      const result =
        await uploadToCloudinary(
          buffer,
          username,
          video
        );


      console.log(
        "Cloudinary upload successful:"
      );

      console.log(
        result.secure_url
      );


      // ------------------------------------------------------
      // SAVE DATABASE
      // ------------------------------------------------------

      await saveVideo(
        videoId,
        username,
        result.secure_url
      );


      uploaded++;


    } catch (error) {

      failed++;

      console.error(
        `Failed video ${videoId}:`
      );

      console.error(
        error.response?.data ||
        error.message
      );

    }

  }


  console.log("");
  console.log(
    `@${username} finished`
  );

  console.log(
    `Uploaded: ${uploaded}`
  );

  console.log(
    `Skipped: ${skipped}`
  );

  console.log(
    `Failed: ${failed}`
  );


  return {
    username,
    success: true,
    uploaded,
    skipped,
    failed
  };
}


// ============================================================
// MAIN
// ============================================================

async function main() {

  console.log("");
  console.log(
    "=========================================="
  );

  console.log(
    "TIKTOK BACKUP STARTED"
  );

  console.log(
    new Date().toISOString()
  );

  console.log(
    "=========================================="
  );


  const results = [];


  for (const username of ACCOUNTS) {

    const result =
      await processAccount(username);

    results.push(result);

  }


  console.log("");
  console.log(
    "=========================================="
  );

  console.log(
    "TIKTOK BACKUP FINISHED"
  );

  console.log(
    new Date().toISOString()
  );

  console.log(
    "=========================================="
  );


  return results;
}


// ============================================================
// VERCEL HANDLER
// ============================================================

module.exports = async function handler(
  req,
  res
) {

  // ----------------------------------------------------------
  // CRON SECURITY
  // ----------------------------------------------------------

  if (process.env.CRON_SECRET) {

    const authHeader =
      req.headers.authorization;

    if (
      authHeader !==
      `Bearer ${process.env.CRON_SECRET}`
    ) {

      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });

    }

  }


  try {

    const results =
      await main();


    return res.status(200).json({

      success: true,

      message:
        "TikTok backup completed",

      time:
        new Date().toISOString(),

      results

    });


  } catch (error) {

    console.error(
      "MAIN ERROR:",
      error
    );


    return res.status(500).json({

      success: false,

      error:
        error.message

    });

  }

};

if (require.main === module) {
  main()
    .then((results) => {
      console.log("\nLocal run completed:");
      console.log(JSON.stringify(results, null, 2));
    })
    .catch((error) => {
      console.error("\nLocal run failed:");
      console.error(error);
      process.exit(1);
    });
}
