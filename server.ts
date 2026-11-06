import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Support large audio base64 uploads (up to 70MB)
app.use(express.json({ limit: '70mb' }));
app.use(express.urlencoded({ extended: true, limit: '70mb' }));

// Initialize GoogleGenAI client (Server-side only per guidelines)
const getAiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment variables');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// Transcription handler supporting structured timestamped lyrics
const handleTranscription = async (req: express.Request, res: express.Response) => {
  try {
    const { audioBase64, mimeType = 'audio/mp3', trackName = '' } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ error: '請提供 audioBase64 音訊數據' });
    }

    let ai;
    try {
      ai = getAiClient();
    } catch (err: any) {
      return res.status(500).json({
        error: '伺服器未設定 GEMINI_API_KEY，請在 Settings > Secrets 面板中設定金鑰。',
      });
    }

    const systemInstruction = `你是一位專業的音訊辨識與卡拉OK歌詞/字幕同步專家。
你的任務是將輸入的音檔精確轉換為帶有時間軸的即時歌詞/字幕片段（Timed Lyrics Segments）。

請遵循以下規則：
1. 仔細辨識音檔中的每一句歌詞、對話或口語句子。
2. 每一句必須包含：
   - startTime: 此句開始時間點（以秒為單位，例如 2.4）
   - endTime: 此句結束時間點（以秒為單位，例如 5.8）
   - text: 原文歌詞或文字（保持原語言，如英文、繁體中文、日文等）
   - translation: 若原句為外文（如英文），請附上簡明流暢的繁體中文翻譯；若原文已經是中文則可留空或略過。
3. startTime 必須依照時間順序遞增，段落長度適合即時卡拉OK逐句高亮滾動閱讀。
4. 輸出必須完全符合所指定的 JSON 格式。`;

    const userPrompt = `請辨識此音檔「${trackName || '音訊檔案'}」，產生高精準度、適合即時滾動顯示的卡拉OK時間軸歌詞。`;

    // Try gemini-3.5-transcribe first, fallback to gemini-3.8-flash if needed
    let responseText: string | undefined;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType || 'audio/mp3',
                data: audioBase64,
              },
            },
            {
              text: `${systemInstruction}\n\n${userPrompt}`,
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            description: 'List of synchronized lyric lines with timestamps',
            items: {
              type: Type.OBJECT,
              properties: {
                startTime: {
                  type: Type.NUMBER,
                  description: 'Start time in seconds from 0',
                },
                endTime: {
                  type: Type.NUMBER,
                  description: 'End time in seconds',
                },
                text: {
                  type: Type.STRING,
                  description: 'Original text or lyric in the audio',
                },
                translation: {
                  type: Type.STRING,
                  description: 'Optional Traditional Chinese translation',
                },
              },
              required: ['startTime', 'endTime', 'text'],
            },
          },
        },
      });
      responseText = response.text;
    } catch (modelErr: any) {
      console.warn('gemini-3.5-transcribe failed, retrying with gemini-3.8-flash:', modelErr);
      const fallbackResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType || 'audio/mp3',
                data: audioBase64,
              },
            },
            {
              text: `${systemInstruction}\n\n${userPrompt}`,
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            description: 'List of synchronized lyric lines with timestamps',
            items: {
              type: Type.OBJECT,
              properties: {
                startTime: {
                  type: Type.NUMBER,
                  description: 'Start time in seconds from 0',
                },
                endTime: {
                  type: Type.NUMBER,
                  description: 'End time in seconds',
                },
                text: {
                  type: Type.STRING,
                  description: 'Original text or lyric in the audio',
                },
                translation: {
                  type: Type.STRING,
                  description: 'Optional Traditional Chinese translation',
                },
              },
              required: ['startTime', 'endTime', 'text'],
            },
          },
        },
      });
      responseText = fallbackResponse.text;
    }

    if (!responseText) {
      throw new Error('Gemini API 未回傳有效的文字內容');
    }

    let segments = [];
    try {
      segments = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse Gemini response as JSON:', responseText);
      // Attempt to extract json block if wrapped in markdown
      const match = responseText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        segments = JSON.parse(match[0]);
      } else {
        throw new Error('無法解析生成的歌詞 JSON 格式');
      }
    }

    return res.json({
      success: true,
      trackName,
      segments,
    });
  } catch (error: any) {
    console.error('Transcription route error:', error);
    return res.status(500).json({
      error: error.message || '音訊轉錄歌詞發生錯誤，請稍後再試。',
    });
  }
};

// Mount API routes at both root and base paths
app.post('/api/transcribe', handleTranscription);
app.post('/easyaudio/api/transcribe', handleTranscription);

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', hasGeminiKey: !!process.env.GEMINI_API_KEY });
});
app.get('/easyaudio/api/health', (_req, res) => {
  res.json({ status: 'ok', hasGeminiKey: !!process.env.GEMINI_API_KEY });
});

// Setup Vite dev server or static file serving
const startServer = async () => {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });

    // In dev, redirect root to /easyaudio/ if needed
    app.get('/', (_req, res, next) => {
      res.redirect('/easyaudio/');
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use('/easyaudio', express.static(distPath));
    app.use(express.static(distPath));

    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(Number(port), '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
  });
};

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
