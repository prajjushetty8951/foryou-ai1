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
app.use(express.json({ limit: '25mb' }));

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

// --- GEMINI 3.8 HELPER (WITH FLASH-LITE BACKUP) ---
async function generateWithGemini38(contents) {
  const models = ['gemini-3.8-flash', 'gemini-3.8-flash-lite'];
  let lastError;

  for (const modelName of models) {
    try {
      return await ai.models.generateContent({
        model: modelName,
        contents,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2
        }
      });
    } catch (err) {
      lastError = err;
      const msg = err.message || '';
      if (
        err.status === 429 ||
        err.status === 503 ||
        err.status === 404 ||
        msg.includes('429') ||
        msg.includes('503') ||
        msg.includes('404')
      ) {
        continue;
      }
      throw err;
    }
  }
  throw lastError;
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

// --- UNIVERSAL MULTIMODAL AI ENGINE (PROXIMITY OBSTACLE + 4-FRAME SIGN BURST) ---
app.post('/api/ai/analyze', authMiddleware, async (req, res) => {
  try {
    const { feature_type, prompt_text, image_base64, images_base64, location_info, destination } = req.body;

    const { data: userProfile } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    const { data: userGestures } = await supabase.from('custom_gestures').select('*').eq('user_id', req.user.id);

    const systemInstructions = {
      safe_route: `You are ForYou AI Live Mobility & Obstacle Avoidance Agent guiding a blind user walking toward: "${destination || prompt_text || 'Safe Clear Path'}".
Live GPS: "${location_info || 'Active'}".
Inspect the live camera image immediately like a human guide walking beside the blind person:
1. OBSTACLE &