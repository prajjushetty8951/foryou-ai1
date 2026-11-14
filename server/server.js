import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { GoogleGenAI } from '@google/genai';
import { supabase } from './db.js';

dotenv.config();

const app = express();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '15mb' }));

// --- ZOD VALIDATION ---
const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  accessibility_mode: z.enum(['blind', 'deaf_mute', 'general']).default('blind'),
  allergies: z.string().optional().default(''),
  emergency_contact: z.string().optional().default('')
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

// --- JWT AUTH MIDDLEWARE ---
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized: Missing token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);
    const password_hash = await bcrypt.hash(data.password, 10);

    const { data: user, error } = await supabase
      .from('users')
      .insert([{
        name: data.name,
        email: data.email,
        password_hash,
        accessibility_mode: data.accessibility_mode,
        allergies: data.allergies,
        emergency_contact: data.emergency_contact
      }])
      .select('id, name, email, accessibility_mode, allergies, emergency_contact')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (err) {
    res.status(400).json({ error: err.errors?.[0]?.message || err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const { data: user, error } = await supabase.from('users').select('*').eq('email', email).single();

    if (error || !user) return res.status(400).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    res.status(400).json({ error: err.errors?.[0]?.message || err.message });
  }
});

// --- CUSTOM GESTURES & QUICK AAC CARDS ---
app.get('/api/gestures', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('custom_gestures')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/gestures', authMiddleware, async (req, res) => {
  const { gesture_name, spoken_phrase_en, spoken_phrase_kn, category } = req.body;
  const { data, error } = await supabase
    .from('custom_gestures')
    .insert([{
      user_id: req.user.id,
      gesture_name,
      spoken_phrase_en,
      spoken_phrase_kn: spoken_phrase_kn || spoken_phrase_en,
      category: category || 'Daily'
    }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// --- UNIVERSAL MULTIMODAL AI & VOICE COMMUNICATOR ENGINE ---
app.post('/api/ai/analyze', authMiddleware, async (req, res) => {
  try {
    const { feature_type, prompt_text, image_base64, location_info, destination } = req.body;

    const { data: userProfile } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    const { data: userGestures } = await supabase.from('custom_gestures').select('*').eq('user_id', req.user.id);

    const systemInstructions = {
      safe_route: `You are ForYou AI Outdoor Safe-Route Navigator guiding a blind pedestrian to their destination: "${destination || prompt_text || 'Nearest Safe Footpath'}".
Live GPS & Telemetry: "${location_info || 'GPS active'}".
Look carefully at the live camera image of the road/walkway:
1. Guide the blind person step-by-step using Clock-Face Directions (e.g., "Walk straight at 12 o'clock on the clear footpath", "Step left to 10 o'clock to avoid a parked bike").
2. Identify road conditions, zebra crossings, traffic signals, oncoming vehicles, autos/bikes, stairs, potholes, open drains, and shop/bus stop signs.
3. Set hazard: true immediately if there is traffic, stairs, pothole, open drain, or a blocking obstacle ahead.
Return strictly valid JSON with no markdown: {
  "en": "Clear, calm 1-2 sentence spoken walking instruction with clock-face direction and obstacle distance in steps",
  "turn_direction": "STRAIGHT" | "LEFT" | "RIGHT" | "STOP" | "ARRIVED",
  "landmark_spotted": "Short label of visible sign, road feature, or landmark",
  "hazard": true/false
}`,
      vision_nav: `You are ForYou AI Spatial Navigator for a blind/low-vision user. Look at the live camera image and describe what is directly ahead using clock-face directions (e.g., "12 o'clock chair 3 steps ahead", "10 o'clock open doorway"), read signs or bus numbers, and warn of hazards. Return strictly valid JSON: {"en": "concise English spoken guidance", "hazard": true/false}`,
      currency_med: `You are ForYou AI Currency & Medicine Identifier for a blind user. User medical allergies: "${userProfile?.allergies || 'None'}".
Look closely at the camera image:
1. If it shows Indian currency notes or coins, state the exact denomination (e.g., "500 Rupees Indian note", "100 Rupees note") and count the total if multiple notes are visible.
2. If it shows a medicine strip, bottle, or tablet, read the medicine name, what it is used for, dosage instructions, and expiry date clearly.
3. Set hazard: true if the medicine is expired or conflicts with the user's allergies.
Return strictly valid JSON: {"en": "Clear spoken identification of the currency amount or medicine name, usage, and expiry date", "hazard": true/false}`,
      sign_bridge: `You are ForYou AI Sign Language & AAC Interpreter. User's saved custom gestures: ${JSON.stringify(userGestures || [])}. Interpret hand gestures in the image or expand quick keywords into a polite spoken sentence. Return strictly valid JSON: {"en": "spoken English sentence", "hazard": false}`,
      memory_vault: `You are ForYou AI Personal Memory Assistant. Describe the object in the camera and its exact surroundings/landmarks so the user can locate it later, or answer where an item was placed. Return strictly valid JSON: {"en": "detailed English spoken memory response", "hazard": false}`,
      sos_alert: `EMERGENCY SOS from ForYou AI! Describe the user's exact surroundings, street landmarks, crowd level, and immediate hazards from the image to guide rescuers. GPS: ${location_info || 'Unknown'}. Guardian Contact: ${userProfile?.emergency_contact || 'Not set'}. Return strictly valid JSON: {"en": "Urgent rescue summary in English", "hazard": true}`,
      form_reader: `You are ForYou AI Document Assistant. Read this form or document image aloud clearly. Summarize what it is for and list the key details or required fields. Return strictly valid JSON: {"en": "English spoken summary and fields", "hazard": false}`
    };

    const contents = [
      { text: `${systemInstructions[feature_type] || systemInstructions.vision_nav}\nUser command/query: ${prompt_text || 'Identify what is in front of the camera and guide me.'}` }
    ];

    if (image_base64) {
      const mimeMatch = image_base64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const base64Data = image_base64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
      contents.push({
        inlineData: { data: base64Data, mimeType }
      });
    }

    let response;
    const fallbackModels = ['gemini-3.8-flash', 'gemini-2.5-flash'];
    let lastError;

    for (const modelName of fallbackModels) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents,
          config: { responseMimeType: 'application/json' }
        });
        break;
      } catch (apiErr) {
        lastError = apiErr;
        const msg = apiErr.message || '';
        if (
          apiErr.status === 429 ||
          apiErr.status === 503 ||
          apiErr.status === 404 ||
          msg.includes('429') ||
          msg.includes('503') ||
          msg.includes('404')
        ) {
          continue;
        }
        throw apiErr;
      }
    }

    if (!response) throw lastError;

    const cleanText = response.text.replace(/```json\s*|```/g, '').trim();
    const parsed = JSON.parse(cleanText);

    const { data: savedLog } = await supabase
      .from('ai_history')
      .insert([{
        user_id: req.user.id,
        feature_type,
        user_prompt: destination ? `Route to: ${destination}` : (prompt_text || 'Optical Scan'),
        ai_response_en: parsed.en,
        ai_response_kn: parsed.en,
        location_info: location_info || ''
      }])
      .select()
      .single();

    res.json({ result: parsed, savedLog });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI processing failed: ' + err.message });
  }
});

// --- HISTORY RETRIEVAL ---
app.get('/api/history', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('ai_history')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/', (req, res) => res.send('ForYou AI Backend Running!'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`ForYou AI Server running on port ${PORT}`));