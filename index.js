const express = require('express');
const OpenAI = require('openai');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();
const fs = require('fs');
const xlsx = require('xlsx');
const bodyParser = require("body-parser");
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const userThreads = new Map();
const userFinancialData = new Map();

function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

app.use((req, res, next) => {
  if (!req.headers['session-id']) {
    req.headers['session-id'] = generateSessionId();
  }
  next();
});

app.post('/upload', upload.single('file'), async (req, res) => {
  const uploadedFile = req.file;
  const sessionId = req.headers['session-id'];
  if (!uploadedFile) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  try {
    const filePath = uploadedFile.path;
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(worksheet);

    const dataString = JSON.stringify(jsonData, null, 2);

    // Store the data
    userFinancialData.set(sessionId, jsonData);

    // Initialize or update the user's thread
    if (!userThreads.has(sessionId)) {
      userThreads.set(sessionId, []);
    }
    const messages = userThreads.get(sessionId);
    messages.push({ 
      role: 'system', 
      content: `You are a professional financial advisor and analyst. You have access to the following financial data: ${dataString}. Use this data to answer user questions accurately and professionally.`
    });

    res.json({ 
      message: 'File processed successfully. The AI is ready to answer questions about your financial data.',
      dataReceived: true,
      sessionId: sessionId
    });
    
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({ message: 'Error processing file', error: error.message });
  } finally {
    if (uploadedFile && uploadedFile.path) {
      fs.unlink(uploadedFile.path, (err) => {
        if (err) console.error('Error deleting file:', err);
      });
    }
  }
});

app.post('/chat', async (req, res) => {
  const sessionId = req.headers['session-id'];
  const message = req.body.message || "";

  try {
    if (!userThreads.has(sessionId)) {
      return res.status(400).json({ error: 'No financial data uploaded for this session. Please upload data first.' });
    }

    const messages = userThreads.get(sessionId);
    messages.push({ role: 'user', content: message });

    const financialData = userFinancialData.get(sessionId);
    if (financialData) {
      messages.push({
        role: 'system',
        content: `Remember to use the financial data provided earlier when answering this question. The data is: ${JSON.stringify(financialData)}`
      });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: messages,
    });

    const assistantMessage = response.choices[0].message.content;
    messages.push({ role: 'assistant', content: assistantMessage });
    res.json({ response: assistantMessage, sessionId: sessionId });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while processing your request.' });
  }
});

app.get('/financial-data', (req, res) => {
  const sessionId = req.headers['session-id'];
  const data = userFinancialData.get(sessionId);
  
  if (data) {
    res.json({ data, sessionId: sessionId });
  } else {
    res.status(404).json({ message: 'No financial data found for this session' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
