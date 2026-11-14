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

// --- GEMINI 3.8 FLASH HELPER ---
async function generateWithGemini38(contents) {
  return await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.2
    }
  });
}

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

// --- LIVE CAMERA AI OBSTACLE, NAVIGATION, CURRENCY & MEDICINE ENGINE ---
app.post('/api/ai/analyze', authMiddleware, async (req, res) => {
  try {
    const { feature_type, prompt_text, image_base64, location_info, destination } = req.body;

    const { data: userProfile } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    const { data: userGestures } = await supabase.from('custom_gestures').select('*').eq('user_id', req.user.id);

    const systemInstructions = {
      safe_route: `You are ForYou AI Live Mobility & Obstacle Avoidance Agent guiding a blind user walking toward: "${destination || prompt_text || 'Safe Clear Path'}".
Live GPS: "${location_info || 'Active'}".
Inspect the live camera image immediately like a human guide walking beside the blind person:
1. OBSTACLE AND SIDE-STEP CHECK FIRST: Look straight ahead (11 to 1 o'clock). If ANY object, person, chair, table, parked bike, vehicle, wall, pillar, stairs, pothole, or barrier is blocking the path:
   - Check which side (left at 9-10 o'clock or right at 2-3 o'clock) has open space.
   - Start your instruction with an immediate action command: "Move Left! [Object] blocking ahead, step left toward 10 o'clock." OR "Move Right! [Object] blocking ahead, step right toward 2 o'clock." OR "Stop! [Danger/Wall/Stairs] right ahead."
   - Set turn_direction to "LEFT", "RIGHT", or "STOP", and set hazard to true.
2. CLEAR PATH: If the path ahead is open and safe, say "Path clear, walk straight ahead at 12 o'clock" and mention any helpful landmark or direction toward "${destination || 'the destination'}". Set turn_direction to "STRAIGHT" and hazard to false.
3. Keep "en" very short, direct, and easy to hear while walking (maximum 1-2 short sentences).
Return strictly valid JSON: {
  "en": "Direct spoken obstacle avoidance and walking instruction",
  "turn_direction": "STRAIGHT" | "LEFT" | "RIGHT" | "STOP" | "ARRIVED",
  "landmark_spotted": "Object or landmark in front of camera",
  "hazard": true/false
}`,
      vision_nav: `You are ForYou AI Real-Time Obstacle & Spatial Agent for a blind user. Look at the live camera frame:
- If an object, person, furniture, doorway edge, or vehicle is in the way, tell the user immediately which side is clear: e.g., "Move right! Chair blocking at 12 o'clock, clear space at 2 o'clock."
- If clear, say what is ahead with clock-face direction.
Return strictly valid JSON: {"en": "short direct spoken guidance", "turn_direction": "STRAIGHT" | "LEFT" | "RIGHT" | "STOP", "hazard": true/false}`,
      currency_med: `You are ForYou AI Currency & Medicine Identifier for a blind user. User medical allergies: "${userProfile?.allergies || 'None'}".
Look closely at the camera image:
1. If Indian currency notes or coins are visible, state the exact note value (e.g., "500 Rupees Indian note", "100 Rupees note", "50 Rupees note") and total sum.
2. If a medicine strip, bottle, or tablet is visible, read the medicine name, purpose, dosage, and expiry date aloud clearly.
3. Set hazard: true if expired or matching user allergies.
Return strictly valid JSON: {"en": "Clear spoken currency amount or medicine details", "hazard": true/false}`,
      sign_bridge: `You are ForYou AI Sign Language & AAC Interpreter. User's saved custom gestures: ${JSON.stringify(userGestures || [])}. Interpret hand gestures in the image or expand quick keywords into a polite spoken sentence. Return strictly valid JSON: {"en": "spoken English sentence", "hazard": false}`,
      memory_vault: `You are ForYou AI Personal Memory Assistant. Describe the object in the camera and its exact surroundings/landmarks so the user can locate it later, or answer where an item was placed. Return strictly valid JSON: {"en": "detailed English spoken memory response", "hazard": false}`,
      sos_alert: `EMERGENCY SOS from ForYou AI! Describe the user's exact surroundings, street landmarks, crowd level, and immediate hazards from the image to guide rescuers. GPS: ${location_info || 'Unknown'}. Guardian Contact: ${userProfile?.emergency_contact || 'Not set'}. Return strictly valid JSON: {"en": "Urgent rescue summary in English", "hazard": true}`,
      form_reader: `You are ForYou AI Document Assistant. Read this form or document image aloud clearly. Summarize what it is for and list the key details or required fields. Return strictly valid JSON: {"en": "English spoken summary and fields", "hazard": false}`
    };

    const contents = [
      { text: `${systemInstructions[feature_type] || systemInstructions.safe_route}\nUser command/query: ${prompt_text || 'Check path ahead for obstacles and guide me.'}` }
    ];

    if (image_base64) {
      const mimeMatch = image_base64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const base64Data = image_base64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
      contents.push({
        inlineData: { data: base64Data, mimeType }
      });
    }

    const response = await generateWithGemini38(contents);
    const rawText = response.text || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch
      ? JSON.parse(jsonMatch[0])
      : { en: rawText.trim() || 'Path scanned.', turn_direction: 'STRAIGHT', hazard: false };

    const { data: savedLog } = await supabase
      .from('ai_history')
      .insert([{
        user_id: req.user.id,
        feature_type,
        user_prompt: destination ? `Route to: ${destination}` : (prompt_text || 'Live Obstacle Scan'),
        ai_response_en: parsed.en,
        ai_response_kn: parsed.en,
        location_info: location_info || ''
      }])
      .select()
      .single();

    res.json({ result: parsed, savedLog });
  } catch (err) {
    console.error('Gemini 3.8 Error:', err);
    const isQuota = err.status === 429 || (err.message || '').includes('429');
    res.status(isQuota ? 429 : 500).json({
      error: isQuota
        ? 'Daily Free Tier quota (20 requests) reached. Add a new API key from a new project in Render Environment.'
        : 'AI processing failed: ' + err.message
    });
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

app.get('/', (req, res) => res.send('ForYou AI Backend Running on Gemini 3.8 Flash!'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`ForYou AI Server running on port ${PORT}`));