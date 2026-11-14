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

// --- UNIVERSAL MULTIMODAL AI ENGINE ---
app.post('/api/ai/analyze', authMiddleware, async (req, res) => {
  try {
    const { feature_type, prompt_text, image_base64, location_info, destination } = req.body;

    const { data: userProfile } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    const { data: userGestures } = await supabase.from('custom_gestures').select('*').eq('user_id', req.user.id);

    const systemInstructions = {
      safe_route: `You are ForYou AI Outdoor Safe-Route Navigator guiding a blind pedestrian to their destination: "${destination || prompt_text || 'Nearest Safe Footpath'}".
Live GPS & Telemetry: "${location_info || 'GPS active'}".
Analyze the live camera view of the street/surroundings carefully:
1. Identify the safest walking path using Clock-Face Directions (e.g., "Walk straight along the 11 o'clock sidewalk", "Step left to 10 o'clock to avoid parked bike").
2. Spot street signs, shop boards, bus stops, crosswalks, traffic signals, stairs, open drains, potholes, or oncoming vehicles.
3. Determine if the destination or a helpful landmark is visible in the frame.
4. Set hazard: true immediately if there is traffic, a red pedestrian signal, stairs, open drain, or a blocking obstacle.
Return strictly valid JSON: {
  "en": "Calm, concise 1-2 sentence step-by-step walking instruction with clock-face direction",
  "turn_direction": "STRAIGHT" | "LEFT" | "RIGHT" | "STOP" | "ARRIVED",
  "landmark_spotted": "Short label of visible sign, road feature, or landmark (e.g. Crosswalk Ahead, Pharmacy Sign, Clear Footpath)",
  "hazard": true/false
}`,
      vision_nav: `You are ForYou AI Spatial Navigator for a blind/low-vision user. Analyze the camera image. Give precise clock-face directions (e.g., "12 o'clock stairs ahead", "10 o'clock clear walkway"), read bus numbers or shop boards, and warn of obstacles. Return strictly valid JSON: {"en": "concise English guidance", "hazard": true/false}`,
      currency_med: `You are ForYou AI Safety Guard. User medical allergies: "${userProfile?.allergies || 'None'}". Identify currency notes (denomination and total), medicine names, dosage, expiry dates, or food allergens. Set hazard: true if expired or matching allergies. Return strictly valid JSON: {"en": "clear English safety alert", "hazard": true/false}`,
      sign_bridge: `You are ForYou AI Sign Language & AAC Interpreter. User's saved custom gestures: ${JSON.stringify(userGestures || [])}. Interpret hand gestures in the image or expand quick keywords into a polite spoken sentence. Return strictly valid JSON: {"en": "spoken English sentence", "hazard": false}`,
      memory_vault: `You are ForYou AI Personal Memory Assistant. Describe the object and its exact surroundings/landmarks so the user can locate it later, or answer where an item was placed. Return strictly valid JSON: {"en": "detailed English memory response", "hazard": false}`,
      sos_alert: `EMERGENCY SOS from ForYou AI! Describe the user's exact surroundings, street landmarks, crowd level, and immediate hazards from the image to guide rescuers. GPS: ${location_info || 'Unknown'}. Guardian Contact: ${userProfile?.emergency_contact || 'Not set'}. Return strictly valid JSON: {"en": "Urgent rescue summary in English", "hazard": true}`,
      form_reader: `You are ForYou AI Document Assistant. Read this form or document image. Summarize what it is for and list the key required fields clearly. Return strictly valid JSON: {"en": "English summary and fields", "hazard": false}`
    };

    const contents = [
      { text: `${systemInstructions[feature_type] || systemInstructions.vision_nav}\nUser command/query: ${prompt_text || 'Guide me safely.'}` }
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
    const fallbackModels = ['gemini-3.8-flash', 'gemini-3.8-pro', 'gemini-3.0-flash', 'gemini-3.1-pro-preview'];
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

    const parsed = JSON.parse(response.text);

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