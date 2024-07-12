require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const schedule = require('node-schedule');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const moment = require('moment'); // 날짜 계산을 위해 moment.js 사용

// Express 앱 초기화
const app = express();

const port = process.env.PORT || 5000;

// MongoDB 연결 설정
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

// 미들웨어 설정
app.use(bodyParser.json());
app.use(cors());

// Mongoose 스키마 및 모델 정의
const videoSchema = new mongoose.Schema({
  videoId: { type: String, required: true, unique: true },
  title: String,
  stats: [{
    date: { type: Date, default: Date.now },
    viewCount: Number
  }]
});

const Video = mongoose.model('Video', videoSchema);

// 유튜브 API 호출 함수
const getYoutubeVideoStats = async (videoId) => {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet,statistics&fields=items(id,snippet(title),statistics(viewCount))&key=${apiKey}`;
    const response = await axios.get(url);

    if (response.data.items.length === 0) {
      throw new Error('No video found with the provided ID.');
    }

    const videoData = response.data.items[0];
    return {
      title: videoData.snippet.title,
      viewCount: videoData.statistics.viewCount
    }; 
  } catch (error) {
    console.error('Error fetching video stats:', error.message);
    throw error;
  }
};

// 유튜브 제목으로 videoId 가져오는 함수
const getYoutubeVideoIdByTitle = async (title) => {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const url = `https://www.googleapis.com/youtube/v3/search?part=id&q=${encodeURIComponent(title)}&type=video&key=${apiKey}`;
    const response = await axios.get(url);

    if (response.data.items.length === 0) {
      throw new Error('No video found with the provided title.');
    }

    const videoId = response.data.items[0].id.videoId;
    return videoId;
  } catch (error) {
    console.error('Error fetching video ID by title:', error.message);
    throw error;
  }
};

// API 엔드포인트 정의
app.get('/api/video/:title', async (req, res) => {
  try {
    const title = req.params.title;
    console.log(title);

    const videoId = await getYoutubeVideoIdByTitle(title);
    let video = await Video.findOne({ videoId });

    if (!video) {
      const videoStats = await getYoutubeVideoStats(videoId);
      video = new Video({
        videoId,
        title: videoStats.title,
        stats: [{ viewCount: videoStats.viewCount }]
      });
      await video.save();
    } else {
        console.log(title + " IN DB!");
    }

    // 지난 1년간의 조회수 추이 계산
    const oneYearAgo = moment().subtract(1, 'years').toDate();
    const statsLastYear = video.stats.filter(stat => stat.date >= oneYearAgo);

    res.json({ ...video.toObject(), stats: statsLastYear });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 주기적으로 조회수 데이터를 수집하는 스케줄러 설정
schedule.scheduleJob('0 * * * *', async () => {
  const videos = await Video.find();
  videos.forEach(async (video) => {
    const stats = await getYoutubeVideoStats(video.videoId);
    video.stats.push({ date: new Date(), viewCount: stats.viewCount });
    await video.save();
  });
});

// 서버 시작
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
