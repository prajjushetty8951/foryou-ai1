import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  Eye, Ear, ShieldAlert, Volume2, VolumeX, Mic, MicOff, Camera, History,
  Plus, LogOut, Sparkles, Bookmark, FileText, Banknote, ArrowRight,
  CheckCircle2, AlertTriangle, Radio, Compass, Navigation, MapPin,
  ArrowUp, ArrowUpLeft, ArrowUpRight, OctagonAlert, Flag, Play, Square,
  ExternalLink, Upload, Activity, Cpu
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const QUICK_DESTINATIONS = [
  'Nearest Bus Stop',
  'Nearest Pharmacy / Medical Shop',
  'Safe Crosswalk / Main Road',
  'Building Exit / Entrance',
  'Nearest Metro / Auto Stand'
];

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('foryou_token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('foryou_user') || 'null'));
  const [isRegister, setIsRegister] = useState(false);
  const [authForm, setAuthForm] = useState({
    name: '', email: '', password: '', accessibility_mode: 'blind', allergies: '', emergency_contact: ''
  });

  const [activeTab, setActiveTab] = useState('safe_route');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [promptText, setPromptText] = useState('');
  const [aiResult, setAiResult] = useState(null);
  const [scanError, setScanError] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [gestures, setGestures] = useState([]);
  const [newGesture, setNewGesture] = useState({ gesture_name: '', spoken_phrase_en: '', category: 'Daily' });
  const [liveTranscript, setLiveTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [uploadedImage, setUploadedImage] = useState(null);

  // Outdoor Safe-Route & Live Obstacle Guard State
  const [destination, setDestination] = useState('');
  const [isWalkingActive, setIsWalkingActive] = useState(false);
  const [isVoiceDestListening, setIsVoiceDestListening] = useState(false);
  const [gpsCoords, setGpsCoords] = useState(null);

  // Layer 1 (0ms Local Edge Sensor) & Layer 2 (Gemini 3.8) Telemetry State
  const [proximityScore, setProximityScore] = useState(0);
  const [edgeAlertActive, setEdgeAlertActive] = useState(false);
  const [apiCallsSaved, setApiCallsSaved] = useState(0);
  const [layer2Status, setLayer2Status] = useState('Standby (Saving Quota)');

  // Hands-Free Two-Way Voice Communicator State
  const [voiceCommActive, setVoiceCommActive] = useState(false);
  const [voiceCommStatus, setVoiceCommStatus] = useState('Tap Start Voice Assistant for hands-free voice control');
  const [voiceCommHeard, setVoiceCommHeard] = useState('');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const sensorCanvasRef = useRef(null);
  const prevFrameDataRef = useRef(null);
  const audioCtxRef = useRef(null);
  const lastBeepTimeRef = useRef(0);
  const lastAiTriggerTimeRef = useRef(0);
  const walkStartedAtRef = useRef(0);

  const fileInputRef = useRef(null);
  const runAIRef = useRef(null);
  const isWalkingRef = useRef(false);
  const isScanningRef = useRef(false);
  const speechStartTimeRef = useRef(0);

  const voiceCommActiveRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const recognitionRef = useRef(null);
  const latestStateRef = useRef({});

  isWalkingRef.current = isWalkingActive;
  latestStateRef.current = {
    activeTab,
    cameraOn,
    uploadedImage,
    gpsCoords,
    destination,
    isWalkingActive
  };

  const api = axios.create({
    baseURL: API_URL,
    headers: { Authorization: `Bearer ${token}` }
  });

  useEffect(() => {
    if (token) {
      fetchHistory();
      fetchGestures();
    }
  }, [token]);

  useEffect(() => {
    if (!token || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsCoords({
          lat: pos.coords.latitude.toFixed(5),
          lng: pos.coords.longitude.toFixed(5),
          accuracy: Math.round(pos.coords.accuracy)
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [token]);

  useEffect(() => {
    return () => {
      voiceCommActiveRef.current = false;
      isWalkingRef.current = false;
      window.speechSynthesis?.cancel();
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
    };
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await api.get('/api/history');
      setHistory(res.data);
    } catch (err) {
      console.error('History fetch error', err);
    }
  };

  const fetchGestures = async () => {
    try {
      const res = await api.get('/api/gestures');
      setGestures(res.data);
    } catch (err) {
      console.error('Gestures fetch error', err);
    }
  };

  // --- LAYER 1: 0ms TACTILE VIBRATION + SIMPLE SOFT SOUND ---
  const initAudioContext = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
    } catch {}
  };

  const triggerSonarBeep = (intensity = 50) => {
    // 1. Strong vibration when object comes close (always active even if sound is muted)
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        if (intensity > 60) {
          navigator.vibrate([220, 80, 220]); // Strong double vibration when very close
        } else {
          navigator.vibrate(150); // Clear single vibration when object approaches
        }
      }
    } catch {}

    // 2. Simple, gentle soft beep sound
    if (!voiceEnabled) return;
    try {
      initAudioContext();
      const ctx = audioCtxRef.current;
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(intensity > 60 ? 640 : 520, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.15);
    } catch {}
  };

  // Synchronously unlocks Android Chrome TTS + Vibration + Sonar Audio on button tap
  const unlockSpeech = (initialMsg) => {
    initAudioContext();
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(40);
      }
    } catch {}
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.resume();
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }
      const u = new SpeechSynthesisUtterance(initialMsg);
      u.lang = 'en-US';
      u.rate = 1.05;
      speechStartTimeRef.current = Date.now();
      u.onend = () => { speechStartTimeRef.current = 0; };
      u.onerror = () => { speechStartTimeRef.current = 0; };
      window.speechSynthesis.speak(u);
    } catch {}
  };

  const speakText = (textEn, force = false) => {
    if ((!voiceEnabled && !force) || !('speechSynthesis' in window) || !textEn) return;
    try {
      window.speechSynthesis.resume();
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }
      setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(textEn);
        utterance.lang = 'en-US';
        utterance.rate = 1.02;
        utterance.onstart = () => {
          speechStartTimeRef.current = Date.now();
        };
        utterance.onend = () => {
          speechStartTimeRef.current = 0;
        };
        utterance.onerror = () => {
          speechStartTimeRef.current = 0;
        };
        window.speechSynthesis.speak(utterance);
      }, 60);
    } catch {}
  };

  const speakWithResume = (textEn, resumeAfter = true) => {
    if (!('speechSynthesis' in window) || !textEn) return;
    try {
      window.speechSynthesis.resume();
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }
    } catch {}
    isSpeakingRef.current = true;
    setVoiceCommStatus('Speaking...');

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }

    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(textEn);
      utterance.lang = 'en-US';
      utterance.rate = 1.02;

      utterance.onend = () => {
        isSpeakingRef.current = false;
        if (resumeAfter && voiceCommActiveRef.current) {
          startVoiceCommListening();
        } else if (!voiceCommActiveRef.current) {
          setVoiceCommStatus('Tap Start Voice Assistant for hands-free voice control');
        }
      };

      utterance.onerror = () => {
        isSpeakingRef.current = false;
        if (resumeAfter && voiceCommActiveRef.current) {
          setTimeout(() => startVoiceCommListening(), 500);
        }
      };

      window.speechSynthesis.speak(utterance);
    }, 60);
  };

  const handleVoiceCommCommand = async (transcript) => {
    setVoiceCommHeard(transcript);
    const cmd = transcript.toLowerCase().trim();
    setVoiceCommStatus('Processing command...');

    if (cmd.includes('stop voice') || cmd.includes('turn off voice') || cmd.includes('exit voice')) {
      voiceCommActiveRef.current = false;
      setVoiceCommActive(false);
      speakWithResume('Voice communicator turned off.', false);
      return;
    }

    if (
      cmd.includes('open camera') ||
      cmd.includes('activate camera') ||
      cmd.includes('start camera') ||
      cmd.includes('turn on camera')
    ) {
      const ok = await startCamera();
      speakWithResume(ok ? 'Camera lens activated. Say start safe walk or ask what is in front of you.' : 'Could not access camera.');
      return;
    }

    if (cmd.includes('start safe walk') || cmd.includes('start live') || cmd.includes('auto guide') || cmd.includes('guide me to')) {
      const destMatch = cmd.split('guide me to')[1]?.trim();
      const target = destMatch || latestStateRef.current.destination || 'Safe Clear Path';
      if (destMatch) setDestination(destMatch);
      const camReady = latestStateRef.current.cameraOn || (await startCamera());
      if (camReady || latestStateRef.current.uploadedImage) {
        setActiveTab('safe_route');
        prevFrameDataRef.current = null;
        walkStartedAtRef.current = Date.now();
        setIsWalkingActive(true);
        isWalkingRef.current = true;
        speakWithResume(`Hybrid proximity vibration and Gemini 3.8 guidance active toward ${target}.`);
        runAIRef.current?.('safe_route', `Guide me safely toward: ${target}. Warn me immediately if any object blocks my path and tell me which side to step.`, target);
      } else {
        speakWithResume('Please allow camera permission first to start live guidance.');
      }
      return;
    }

    if (cmd.includes('stop safe walk') || cmd.includes('stop walk') || cmd.includes('stop guide')) {
      setIsWalkingActive(false);
      isWalkingRef.current = false;
      speakWithResume('Safe walk guidance stopped.');
      return;
    }

    if (cmd.includes('emergency') || cmd.includes('sos') || cmd.includes('help me')) {
      speakWithResume('Triggering Emergency SOS alert now.');
      runAIRef.current?.('sos_alert', 'EMERGENCY SOS! Analyze immediate surroundings and broadcast safety alert.');
      return;
    }

    if (cmd.includes('safe route') || cmd.includes('navigation')) {
      setActiveTab('safe_route');
      setAiResult(null);
      speakWithResume('Switched to Safe Route.');
      return;
    }
    if (cmd.includes('spatial') || cmd.includes('obstacle') || cmd.includes('clock face')) {
      setActiveTab('vision_nav');
      setAiResult(null);
      speakWithResume('Switched to Spatial Navigation.');
      return;
    }
    if (cmd.includes('currency') || cmd.includes('money') || cmd.includes('medicine') || cmd.includes('tablet')) {
      setActiveTab('currency_med');
      setAiResult(null);
      speakWithResume('Switched to Currency and Medicine reader.');
      return;
    }
    if (cmd.includes('sign') || cmd.includes('bridge') || cmd.includes('caption')) {
      setActiveTab('sign_bridge');
      setAiResult(null);
      speakWithResume('Switched to Sign and Flip Bridge.');
      return;
    }
    if (cmd.includes('memory') || cmd.includes('vault') || cmd.includes('remember')) {
      setActiveTab('memory_vault');
      setAiResult(null);
      speakWithResume('Switched to Memory Vault.');
      return;
    }
    if (cmd.includes('form') || cmd.includes('document') || cmd.includes('read text')) {
      setActiveTab('form_reader');
      setAiResult(null);
      speakWithResume('Switched to Form Reader.');
      return;
    }

    try {
      setVoiceCommStatus('Scanning with Gemini 3.8...');
      const image_base64 = captureFrame();
      const gps = latestStateRef.current.gpsCoords;
      const location_info = gps ? `Lat: ${gps.lat}, Lng: ${gps.lng} (±${gps.accuracy}m)` : '';

      const res = await api.post('/api/ai/analyze', {
        feature_type: latestStateRef.current.activeTab,
        prompt_text: transcript,
        image_base64,
        location_info,
        destination: latestStateRef.current.destination
      });

      const result = res.data.result;
      setScanError('');
      setAiResult(result);
      if (result.hazard && navigator.vibrate) {
        navigator.vibrate([300, 100, 300, 100, 450]);
      }
      fetchHistory();
      speakWithResume(result.en || 'Scan complete.', true);
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not reach the AI server right now.';
      setScanError(msg);
      speakWithResume(msg, true);
    }
  };

  const startVoiceCommListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceCommStatus('Voice recognition requires Chrome or Brave browser.');
      return;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => {
      setVoiceCommStatus('Listening... Speak a command or question');
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      handleVoiceCommCommand(transcript);
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        voiceCommActiveRef.current = false;
        setVoiceCommActive(false);
        setVoiceCommStatus('Microphone blocked. Allow mic permission in browser settings.');
        return;
      }
      if (voiceCommActiveRef.current && !isSpeakingRef.current) {
        setTimeout(() => startVoiceCommListening(), 700);
      }
    };

    recognition.onend = () => {
      if (voiceCommActiveRef.current && !isSpeakingRef.current) {
        setTimeout(() => {
          if (voiceCommActiveRef.current && !isSpeakingRef.current) {
            startVoiceCommListening();
          }
        }, 400);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {}
  };

  const toggleVoiceCommunicator = () => {
    initAudioContext();
    if (!voiceCommActive) {
      voiceCommActiveRef.current = true;
      setVoiceCommActive(true);
      speakWithResume(
        'Voice communicator is active. Say open camera, start safe walk, or ask what is in front of you.',
        true
      );
    } else {
      voiceCommActiveRef.current = false;
      setVoiceCommActive(false);
      window.speechSynthesis?.cancel();
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
      setVoiceCommStatus('Tap Start Voice Assistant for hands-free voice control');
    }
  };

  const listenForDestination = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert('Voice recognition is supported in Google Chrome or Brave.');
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.onstart = () => setIsVoiceDestListening(true);
    recognition.onresult = (e) => {
      const spokenDest = e.results[0][0].transcript;
      setDestination(spokenDest);
      setIsVoiceDestListening(false);
      startSafeWalk(spokenDest);
    };
    recognition.onerror = () => setIsVoiceDestListening(false);
    recognition.start();
  };

  const toggleListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert('Speech Recognition is supported in Google Chrome or Brave.');
    if (isListening) {
      setIsListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (e) => {
      setLiveTranscript(e.results[0][0].transcript);
      setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.start();
  };

  const startCamera = async () => {
    try {
      setUploadedImage(null);
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise((resolve) => {
          videoRef.current.onloadedmetadata = () => resolve();
        });
        await videoRef.current.play();
        await new Promise((r) => setTimeout(r, 250));
        setCameraOn(true);
        return true;
      }
      return false;
    } catch (err) {
      alert(
        'Camera blocked (' +
          err.name +
          '). Click the lock/site icon in your address bar, set Camera to Allow, and reload.'
      );
      return false;
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedImage(reader.result);
      setCameraOn(false);
    };
    reader.readAsDataURL(file);
  };

  const captureFrame = () => {
    if (uploadedImage) return uploadedImage;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.srcObject || video.readyState < 2 || video.videoWidth === 0) {
      return null;
    }
    const maxWidth = 640;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
      const res = await axios.post(`${API_URL}${endpoint}`, authForm);
      localStorage.setItem('foryou_token', res.data.token);
      localStorage.setItem('foryou_user', JSON.stringify(res.data.user));
      setToken(res.data.token);
      setUser(res.data.user);
    } catch (err) {
      alert(err.response?.data?.error || 'Authentication failed');
    }
  };

  const handleLogout = () => {
    voiceCommActiveRef.current = false;
    isWalkingRef.current = false;
    setVoiceCommActive(false);
    setIsWalkingActive(false);
    window.speechSynthesis?.cancel();
    localStorage.removeItem('foryou_token');
    localStorage.removeItem('foryou_user');
    setToken('');
    setUser(null);
  };

  const runAI = async (overrideFeature = null, overridePrompt = null, overrideDest = null) => {
    if (isScanningRef.current) return;
    const feature_type = overrideFeature || activeTab;
    const finalPrompt = overridePrompt !== null ? overridePrompt : promptText;
    const activeDest = overrideDest !== null ? overrideDest : destination;
    const image_base64 = captureFrame();

    if (!image_base64 && !finalPrompt) {
      alert('No live camera video detected yet. Click "Activate Camera Lens" or "Upload Photo" first.');
      return;
    }

    if (!overrideFeature) {
      unlockSpeech('Scanning...');
    }

    isScanningRef.current = true;
    lastAiTriggerTimeRef.current = Date.now();
    setLoading(true);
    setLayer2Status('Analyzing Obstacle with Gemini 3.8...');

    try {
      let location_info = gpsCoords
        ? `Lat: ${gpsCoords.lat}, Lng: ${gpsCoords.lng} (±${gpsCoords.accuracy}m)`
        : '';

      if (!location_info && (feature_type === 'sos_alert' || feature_type === 'safe_route') && navigator.geolocation) {
        await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              location_info = `Lat: ${pos.coords.latitude.toFixed(5)}, Lng: ${pos.coords.longitude.toFixed(5)}`;
              resolve();
            },
            () => resolve(),
            { timeout: 2000 }
          );
        });
      }

      const res = await api.post(
        '/api/ai/analyze',
        {
          feature_type,
          prompt_text: finalPrompt,
          image_base64,
          location_info,
          destination: activeDest
        },
        { timeout: 20000 }
      );

      const result = res.data.result;
      setScanError('');
      setAiResult(result);
      setLayer2Status('Guidance Spoken — Standby (Saving Quota)');

      if (result.turn_direction === 'ARRIVED') {
        setIsWalkingActive(false);
        isWalkingRef.current = false;
      }

      if (result.hazard && navigator.vibrate) {
        navigator.vibrate([300, 100, 300, 100, 450]);
      }

      if (voiceCommActiveRef.current) {
        speakWithResume(result.en, true);
      } else {
        speakText(result.en);
      }
      fetchHistory();
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message || 'AI Analysis failed';
      setScanError(errMsg);
      setLayer2Status('Quota Limit / Standby (Vibration & Beep Active)');
      if (!isWalkingRef.current) {
        alert(errMsg);
      }
    } finally {
      isScanningRef.current = false;
      setLoading(false);
    }
  };

  runAIRef.current = runAI;

  const startSafeWalk = async (customDest = null) => {
    const target = customDest || destination || 'Safe Clear Path';
    if (!destination && customDest) setDestination(customDest);

    unlockSpeech(`0 millisecond proximity vibration and Gemini guide active toward ${target}.`);
    setScanError('');
    prevFrameDataRef.current = null;
    walkStartedAtRef.current = Date.now();
    setApiCallsSaved(0);
    setProximityScore(0);
    setEdgeAlertActive(false);

    const camReady = cameraOn || (await startCamera());
    if (!camReady && !uploadedImage) return;

    setIsWalkingActive(true);
    isWalkingRef.current = true;
    runAI(
      'safe_route',
      `Guide me safely toward: ${target}. Detect any objects or obstacles in front of the camera and tell me whether to move left, move right, stop, or walk straight.`,
      target
    );
  };

  const stopSafeWalk = () => {
    setIsWalkingActive(false);
    isWalkingRef.current = false;
    prevFrameDataRef.current = null;
    setProximityScore(0);
    setEdgeAlertActive(false);
    setLayer2Status('Standby (Saving Quota)');
    unlockSpeech('Hybrid obstacle and route guidance paused.');
  };

  // --- 2-LAYER HYBRID LOOP: 100ms Local Proximity Sensor + Smart Gemini Trigger ---
  useEffect(() => {
    if (!isWalkingActive) return;

    if (!sensorCanvasRef.current) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 48;
      sensorCanvasRef.current = c;
    }

    let frameTick = 0;

    const sensorInterval = setInterval(() => {
      if (!isWalkingRef.current) return;
      const video = videoRef.current;
      const canvas = sensorCanvasRef.current;
      if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0) return;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, 64, 48);
      const frame = ctx.getImageData(0, 0, 64, 48).data;

      if (prevFrameDataRef.current) {
        const prev = prevFrameDataRef.current;
        let centerDelta = 0;
        let centerCount = 0;

        // Inspect center 12 o'clock danger zone (x: 18..46, y: 10..42)
        for (let y = 10; y < 42; y++) {
          for (let x = 18; x < 46; x++) {
            const idx = (y * 64 + x) * 4;
            const diff =
              Math.abs(frame[idx] - prev[idx]) +
              Math.abs(frame[idx + 1] - prev[idx + 1]) +
              Math.abs(frame[idx + 2] - prev[idx + 2]);
            centerDelta += diff / 3;
            centerCount++;
          }
        }

        const avgDelta = centerDelta / centerCount;
        const score = Math.min(100, Math.round(avgDelta * 2.4));
        setProximityScore(score);

        const now = Date.now();
        const warmedUp = now - walkStartedAtRef.current > 1200;

        if (warmedUp && score >= 36) {
          setEdgeAlertActive(true);

          // Layer 1: Immediate 0ms Vibration + Simple Soft Beep when object approaches
          const beepGapMs = score > 60 ? 480 : 680;
          if (now - lastBeepTimeRef.current > beepGapMs) {
            lastBeepTimeRef.current = now;
            triggerSonarBeep(score);
          }

          // Layer 2: Trigger Gemini 3.8 ONLY when obstacle spike occurs & cooldown (7.5s) passed
          if (!isScanningRef.current && now - lastAiTriggerTimeRef.current > 7500) {
            runAIRef.current?.(
              'safe_route',
              `URGENT OBSTACLE DETECTED AHEAD! Identify the blocking object in front of the camera and tell me immediately whether to move left, move right, or stop while heading toward: ${destination || 'Safe Clear Path'}.`,
              destination
            );
          }
        } else {
          setEdgeAlertActive(false);
          frameTick++;
          if (frameTick % 30 === 0) {
            setApiCallsSaved((prevCount) => prevCount + 1);
          }
        }
      }

      prevFrameDataRef.current = new Uint8ClampedArray(frame);
    }, 100);

    return () => clearInterval(sensorInterval);
  }, [isWalkingActive, destination, voiceEnabled]);

  const handleSaveGesture = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/gestures', {
        ...newGesture,
        spoken_phrase_kn: newGesture.spoken_phrase_en
      });
      setNewGesture({ gesture_name: '', spoken_phrase_en: '', category: 'Daily' });
      fetchGestures();
    } catch {
      alert('Failed to save gesture');
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute w-[500px] h-[500px] bg-amber-500/10 rounded-full blur-[130px] -top-32 -left-32 pointer-events-none" />
        <div className="absolute w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-[120px] bottom-0 right-0 pointer-events-none" />

        <div className="max-w-md w-full glass-panel rounded-3xl p-8 relative z-10">
          <div className="flex items-center gap-3.5 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Sparkles className="w-6 h-6 text-zinc-950" />
            </div>
            <div>
              <h1 className="font-serif-display text-3xl tracking-tight text-white">ForYou AI</h1>
              <p className="text-xs uppercase tracking-[0.2em] text-amber-400/90 font-semibold">
                Sensory Intelligence
              </p>
            </div>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {isRegister && (
              <>
                <input
                  type="text" placeholder="Full Name" required
                  className="w-full px-4 py-3 rounded-xl bg-zinc-900/90 border border-white/10 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/60"
                  value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                />
                <select
                  className="w-full px-4 py-3 rounded-xl bg-zinc-900/90 border border-white/10 text-white focus:outline-none focus:border-amber-500/60"
                  value={authForm.accessibility_mode}
                  onChange={(e) => setAuthForm({ ...authForm, accessibility_mode: e.target.value })}
                >
                  <option value="blind">Blind / Low Vision Navigation</option>
                  <option value="deaf_mute">Deaf / Non-Verbal Bridge</option>
                  <option value="general">Caregiver / General Assistance</option>
                </select>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text" placeholder="Medical Allergies"
                    className="w-full px-3.5 py-3 rounded-xl bg-zinc-900/90 border border-white/10 text-white placeholder-zinc-500 text-sm"
                    value={authForm.allergies} onChange={(e) => setAuthForm({ ...authForm, allergies: e.target.value })}
                  />
                  <input
                    type="text" placeholder="Emergency Contact"
                    className="w-full px-3.5 py-3 rounded-xl bg-zinc-900/90 border border-white/10 text-white placeholder-zinc-500 text-sm"
                    value={authForm.emergency_contact} onChange={(e) => setAuthForm({ ...authForm, emergency_contact: e.target.value })}
                  />
                </div>
              </>
            )}

            <input
              type="email" placeholder="Email Address" required
              className="w-full px-4 py-3 rounded-xl bg-zinc-900/90 border border-white/10 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/60"
              value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
            />
            <input
              type="password" placeholder="Password (min 6 chars)" required
              className="w-full px-4 py-3 rounded-xl bg-zinc-900/90 border border-white/10 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/60"
              value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
            />

            <button
              type="submit"
              className="w-full py-3.5 mt-2 bg-gradient-to-r from-amber-400 to-amber-500 hover:brightness-110 text-zinc-950 rounded-xl font-bold text-sm tracking-wide flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 cursor-pointer"
            >
              {isRegister ? 'Create Private Account' : 'Enter Workspace'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <button
            onClick={() => setIsRegister(!isRegister)}
            className="w-full mt-6 pt-5 border-t border-white/5 text-xs text-zinc-400 hover:text-amber-300 text-center cursor-pointer"
          >
            {isRegister ? 'Already registered? Sign in to your workspace' : 'First time here? Create a ForYou AI account'}
          </button>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'safe_route', label: 'Safe Route', desc: '0ms proximity sonar + AI path guide', icon: Navigation },
    { id: 'vision_nav', label: 'Spatial Nav', desc: 'Clock-face obstacle & transit guidance', icon: Compass },
    { id: 'currency_med', label: 'Currency & Meds', desc: 'Notes, dosage & allergy verification', icon: Banknote },
    { id: 'sign_bridge', label: 'Sign & Flip Bridge', desc: 'Two-way gesture & caption communicator', icon: Ear },
    { id: 'memory_vault', label: 'Memory Vault', desc: 'Remember where personal items are placed', icon: Bookmark },
    { id: 'form_reader', label: 'Form Reader', desc: 'Summarize documents & required fields', icon: FileText },
  ];

  const activeTabInfo = tabs.find((t) => t.id === activeTab);

  const renderDirectionIcon = (dir) => {
    switch (dir) {
      case 'LEFT':
        return <ArrowUpLeft className="w-7 h-7 text-amber-300" />;
      case 'RIGHT':
        return <ArrowUpRight className="w-7 h-7 text-amber-300" />;
      case 'STOP':
        return <OctagonAlert className="w-7 h-7 text-rose-400 animate-pulse" />;
      case 'ARRIVED':
        return <Flag className="w-7 h-7 text-emerald-400" />;
      default:
        return <ArrowUp className="w-7 h-7 text-emerald-400" />;
    }
  };

  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-zinc-950/75 border-b border-white/[0.07]">
        <div className="max-w-6xl mx-auto px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-md shadow-amber-500/20">
              <Sparkles className="w-5 h-5 text-zinc-950" />
            </div>
            <div className="flex items-center gap-2.5">
              <span className="font-serif-display text-2xl tracking-tight text-white">ForYou AI</span>
              <span className="text-[11px] uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-zinc-300 font-medium">
                {user?.name}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setVoiceEnabled(!voiceEnabled)}
              className={`px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
                voiceEnabled
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : 'bg-zinc-900 border-white/10 text-zinc-400'
              }`}
            >
              {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              {voiceEnabled ? 'Voice & Sonar On' : 'Audio Muted'}
            </button>

            <button
              onClick={() => runAI('sos_alert', 'EMERGENCY SOS! Analyze immediate surroundings and broadcast safety alert.')}
              className="px-4 py-2 rounded-xl bg-rose-600/90 hover:bg-rose-500 border border-rose-400/30 text-white text-xs font-bold tracking-wider uppercase flex items-center gap-1.5 shadow-lg shadow-rose-600/25 transition cursor-pointer"
            >
              <ShieldAlert className="w-4 h-4" /> Emergency SOS
            </button>

            <button
              onClick={handleLogout}
              className="p-2.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-white/10 text-zinc-400 hover:text-white transition cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 pt-8 space-y-8">
        {/* Hands-Free Two-Way Voice Communicator Bar */}
        <div
          className={`glass-panel rounded-3xl p-5 border transition-all ${
            voiceCommActive
              ? 'border-amber-400/60 bg-gradient-to-r from-amber-500/15 via-zinc-900/90 to-zinc-900/90 shadow-lg shadow-amber-500/10'
              : 'border-white/10'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    voiceCommActive ? 'bg-amber-400 animate-ping' : 'bg-zinc-500'
                  }`}
                />
                <span className="text-xs uppercase tracking-[0.2em] text-amber-400 font-bold">
                  Hands-Free Voice Communicator
                </span>
              </div>
              <p className="text-sm text-zinc-200 font-medium">{voiceCommStatus}</p>
              {voiceCommHeard && (
                <p className="text-xs text-zinc-400">
                  Last heard: <span className="text-amber-200 font-medium">"{voiceCommHeard}"</span>
                </p>
              )}
            </div>

            <button
              onClick={toggleVoiceCommunicator}
              className={`px-5 py-3.5 rounded-2xl font-extrabold text-xs uppercase tracking-wider flex items-center gap-2 transition cursor-pointer shadow-lg ${
                voiceCommActive
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/25'
                  : 'bg-gradient-to-r from-amber-400 to-amber-500 hover:brightness-110 text-zinc-950 shadow-amber-500/20'
              }`}
            >
              {voiceCommActive ? (
                <>
                  <MicOff className="w-4 h-4" /> Stop Voice Assistant
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" /> Start Voice Assistant
                </>
              )}
            </button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold mb-1">
              2-Layer Hybrid Sensory Engine
            </p>
            <h2 className="font-serif-display text-4xl text-white tracking-tight">
              {activeTabInfo?.label}
            </h2>
            <p className="text-sm text-zinc-400 mt-1">{activeTabInfo?.desc}</p>
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-400 bg-white/[0.03] border border-white/[0.07] px-3.5 py-2 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {gpsCoords ? `GPS Locked (${gpsCoords.lat}, ${gpsCoords.lng})` : '0ms Edge Sonar + Gemini 3.8 Ready'}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setActiveTab(t.id);
                  setAiResult(null);
                  setScanError('');
                  if (t.id !== 'safe_route') {
                    setIsWalkingActive(false);
                    isWalkingRef.current = false;
                  }
                }}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                  isActive
                    ? 'bg-gradient-to-b from-amber-500/20 to-amber-500/5 border-amber-400/50 shadow-lg shadow-amber-500/10'
                    : 'glass-card'
                }`}
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${
                  isActive ? 'bg-amber-400 text-zinc-950' : 'bg-white/[0.06] text-zinc-300'
                }`}>
                  <Icon className="w-4 h-4" />
                </div>
                <p className={`font-semibold text-sm ${isActive ? 'text-white' : 'text-zinc-300'}`}>
                  {t.label}
                </p>
                <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-1">{t.desc}</p>
              </button>
            );
          })}
        </div>

        {activeTab === 'safe_route' && (
          <div className="glass-panel rounded-3xl p-6 space-y-4 border border-amber-500/20">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-amber-400" />
                <span className="text-xs uppercase tracking-[0.18em] text-amber-300 font-bold">
                  0ms Proximity Vibration & Beep + Gemini 3.8 Guide
                </span>
              </div>
              {destination && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=walking`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-zinc-300 hover:text-amber-300 inline-flex items-center gap-1 underline"
                >
                  Open Walking Map <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  placeholder="Destination (optional) — or tap Start Live Obstacle & Walk Guide"
                  className="flex-1 px-4 py-3.5 rounded-xl bg-zinc-900/90 border border-white/10 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/60"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                />
                <button
                  type="button"
                  onClick={listenForDestination}
                  className={`px-4 rounded-xl border flex items-center gap-2 text-xs font-bold uppercase tracking-wider cursor-pointer ${
                    isVoiceDestListening
                      ? 'bg-rose-600 border-rose-400 text-white animate-pulse'
                      : 'bg-zinc-900 hover:bg-zinc-800 border-white/15 text-amber-300'
                  }`}
                  title="Speak Destination"
                >
                  <Mic className="w-4 h-4" />
                  <span className="hidden md:inline">{isVoiceDestListening ? 'Listening...' : 'Speak Place'}</span>
                </button>
              </div>

              {!isWalkingActive ? (
                <button
                  onClick={() => startSafeWalk()}
                  className="px-6 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" /> Start Live Obstacle & Walk Guide
                </button>
              ) : (
                <button
                  onClick={stopSafeWalk}
                  className="px-6 py-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 animate-pulse cursor-pointer"
                >
                  <Square className="w-4 h-4 fill-current" /> Stop Live Guide
                </button>
              )}
            </div>

            {/* 2-Layer Hybrid Live Telemetry Strip */}
            {isWalkingActive && (
              <div className="grid sm:grid-cols-2 gap-3 pt-1">
                <div
                  className={`p-3.5 rounded-2xl border transition-all ${
                    edgeAlertActive
                      ? 'bg-rose-950/60 border-rose-400 shadow-md shadow-rose-500/20'
                      : 'bg-zinc-900/80 border-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="font-bold uppercase tracking-wider flex items-center gap-1.5 text-amber-300">
                      <Activity className="w-3.5 h-3.5" /> Layer 1: 0ms Proximity Vibration & Beep
                    </span>
                    <span className={`font-extrabold ${edgeAlertActive ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {edgeAlertActive ? `VIBRATE + BEEP (${proximityScore}%)` : `CLEAR (${proximityScore}%)`}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-black/60 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-100 ${
                        edgeAlertActive ? 'bg-rose-500' : 'bg-emerald-400'
                      }`}
                      style={{ width: `${proximityScore}%` }}
                    />
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-white/10 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-indigo-300">
                      <Cpu className="w-3.5 h-3.5" /> Layer 2: Gemini 3.8 AI Brain
                    </p>
                    <p className="text-xs text-zinc-400 mt-1">{layer2Status}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-extrabold text-emerald-400">{apiCallsSaved}</span>
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">API Calls Saved</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider mr-1">Quick Places:</span>
              {QUICK_DESTINATIONS.map((place) => (
                <button
                  key={place}
                  onClick={() => startSafeWalk(place)}
                  className={`px-3 py-1.5 rounded-full text-xs border transition cursor-pointer ${
                    destination === place
                      ? 'bg-amber-400/20 border-amber-400 text-amber-200 font-semibold'
                      : 'bg-zinc-900/80 border-white/10 text-zinc-300 hover:border-amber-400/40'
                  }`}
                >
                  {place}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 glass-panel rounded-3xl p-5 flex flex-col justify-between space-y-4">
            <div className="relative aspect-video bg-zinc-950 rounded-2xl overflow-hidden border border-white/10 flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${cameraOn && !uploadedImage ? '' : 'hidden'}`}
              />
              {uploadedImage && (
                <img src={uploadedImage} alt="Uploaded preview" className="w-full h-full object-contain bg-zinc-950" />
              )}

              {/* 12 O'Clock Sonar Reticle Overlay during Live Obstacle Guard */}
              {cameraOn && isWalkingActive && (
                <div
                  className={`pointer-events-none absolute inset-x-[28%] inset-y-[20%] rounded-2xl border-2 transition-all duration-100 flex items-end justify-center pb-2 ${
                    edgeAlertActive
                      ? 'border-rose-500 bg-rose-500/15 animate-pulse'
                      : 'border-emerald-400/40'
                  }`}
                >
                  <span className="px-2 py-0.5 rounded bg-black/70 text-[10px] font-bold uppercase tracking-widest text-white">
                    12 O'Clock Sonar Zone
                  </span>
                </div>
              )}

              {(cameraOn || uploadedImage) && (
                <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
                  <div className="px-2.5 py-1 rounded-full bg-black/65 backdrop-blur-md border border-white/10 flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
                    <Radio className="w-3 h-3 animate-pulse" />
                    {uploadedImage
                      ? 'Uploaded Photo Ready'
                      : isWalkingActive
                      ? '0ms Sonar + AI Guard Active'
                      : 'Live Optical Feed'}
                  </div>
                  <div className="flex gap-1.5">
                    {uploadedImage && (
                      <button
                        onClick={startCamera}
                        className="px-2.5 py-1 rounded-full bg-black/75 text-[11px] text-white border border-white/15 cursor-pointer"
                      >
                        Use Camera
                      </button>
                    )}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2.5 py-1 rounded-full bg-black/75 text-[11px] text-amber-300 border border-white/15 cursor-pointer"
                    >
                      Upload Photo
                    </button>
                  </div>
                </div>
              )}

              {!cameraOn && !uploadedImage && (
                <div className="text-center p-6">
                  <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center mx-auto mb-3">
                    <Eye className="w-6 h-6 text-amber-400" />
                  </div>
                  <p className="text-sm text-zinc-400 mb-4">Activate camera lens or upload a photo to identify</p>
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      onClick={startCamera}
                      className="px-4 py-2.5 bg-white text-zinc-950 hover:bg-amber-300 rounded-xl font-semibold text-xs tracking-wide uppercase inline-flex items-center gap-2 transition cursor-pointer"
                    >
                      <Camera className="w-4 h-4" /> Activate Camera Lens
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-white/15 text-zinc-200 rounded-xl font-semibold text-xs tracking-wide uppercase inline-flex items-center gap-2 transition cursor-pointer"
                    >
                      <Upload className="w-4 h-4 text-amber-400" /> Upload Photo
                    </button>
                  </div>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <canvas ref={canvasRef} className="hidden" />
            </div>

            <div className="space-y-3">
              <input
                type="text"
                placeholder={
                  activeTab === 'safe_route'
                    ? 'Ask route question (e.g., "Is there any obstacle ahead?" or "Which side is clear?")...'
                    : activeTab === 'memory_vault'
                    ? 'Ask or save: "Remember my keys on the wooden desk"'
                    : 'Optional context (e.g., "Identify this currency note" or "Check medicine expiry")...'
                }
                className="w-full px-4 py-3.5 rounded-xl bg-zinc-900/90 border border-white/10 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/60 transition"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
              />
              <button
                onClick={() => runAI()}
                disabled={loading}
                className="w-full py-4 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 hover:brightness-110 disabled:opacity-50 text-zinc-950 rounded-xl font-bold text-sm tracking-wide uppercase shadow-lg shadow-amber-500/20 transition cursor-pointer"
              >
                {loading
                  ? 'Scanning Surroundings...'
                  : activeTab === 'safe_route'
                  ? 'Scan Path & Guide Now'
                  : 'Capture & Analyze'}
              </button>
            </div>
          </div>

          <div className="lg:col-span-6 glass-panel rounded-3xl p-6 flex flex-col justify-between space-y-5">
            {activeTab === 'sign_bridge' && aiResult && (
              <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-950/90 to-zinc-900 border border-indigo-400/30 rotate-180 text-center shadow-inner">
                <p className="text-[10px] uppercase tracking-[0.25em] text-indigo-300 mb-1.5">
                  Listener Display (Flipped View)
                </p>
                <p className="text-xl font-semibold text-white leading-snug">{aiResult.en}</p>
              </div>
            )}

            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs uppercase tracking-[0.18em] text-zinc-400 font-semibold">
                  {activeTab === 'safe_route' ? 'Live Obstacle & Route Voice Guidance' : 'AI Sensory Readout'}
                </span>
                {aiResult && (
                  <button
                    onClick={() => speakText(aiResult.en, true)}
                    className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-amber-300 flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Volume2 className="w-3.5 h-3.5" /> Speak Again
                  </button>
                )}
              </div>

              {scanError && (
                <div className="mb-3 p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/50 text-xs text-rose-200">
                  <strong className="uppercase tracking-wider block mb-1 text-rose-400">Scanner Notice:</strong>
                  {scanError}
                </div>
              )}

              {aiResult ? (
                <div
                  className={`flex-1 p-6 rounded-2xl border flex flex-col justify-center space-y-4 ${
                    aiResult.hazard
                      ? 'bg-rose-950/35 border-rose-500/40'
                      : 'bg-zinc-900/70 border-white/10'
                  }`}
                >
                  {(activeTab === 'safe_route' || aiResult.turn_direction) && (
                    <div className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-black/40 border border-white/10">
                      <div className="w-12 h-12 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0">
                        {renderDirectionIcon(aiResult.turn_direction)}
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-widest text-zinc-400">
                          Recommended Action
                        </p>
                        <p className="text-lg font-extrabold text-white tracking-wide">
                          {aiResult.turn_direction === 'LEFT'
                            ? 'MOVE LEFT (SIDE-STEP)'
                            : aiResult.turn_direction === 'RIGHT'
                            ? 'MOVE RIGHT (SIDE-STEP)'
                            : aiResult.turn_direction || 'PROCEED CAREFULLY'}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    {aiResult.hazard ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-rose-400 bg-rose-500/15 px-2.5 py-1 rounded-full">
                        <AlertTriangle className="w-3.5 h-3.5" /> Object Blocking — Move Side
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Safe Path Verified
                      </span>
                    )}
                  </div>

                  <p className="text-lg md:text-xl font-medium text-zinc-100 leading-relaxed">
                    {aiResult.en}
                  </p>
                </div>
              ) : (
                <div className="flex-1 p-8 rounded-2xl bg-zinc-900/40 border border-dashed border-white/10 flex flex-col items-center justify-center text-center">
                  <Navigation className="w-7 h-7 text-amber-400/60 mb-3" />
                  <p className="text-sm text-zinc-300 font-medium">
                    {loading
                      ? 'Analyzing Live Camera Frame...'
                      : activeTab === 'safe_route'
                      ? 'Tap "Start Live Obstacle & Walk Guide"'
                      : 'Awaiting Visual or Text Input'}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1 max-w-sm leading-relaxed">
                    {activeTab === 'safe_route'
                      ? 'Layer 1 gives instant 0ms vibration & simple soft beeps when an object approaches, and Layer 2 triggers Gemini 3.8 only when needed to guide you left or right.'
                      : 'Point your camera at currency notes, medicine labels, or documents and select Capture & Analyze.'}
                  </p>
                </div>
              )}
            </div>

            {activeTab === 'sign_bridge' && (
              <div className="p-4 rounded-2xl bg-zinc-900/80 border border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                    Live Voice-to-Text Captions
                  </span>
                  <button
                    onClick={toggleListening}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                      isListening
                        ? 'bg-rose-600 text-white animate-pulse'
                        : 'bg-amber-400 text-zinc-950 hover:bg-amber-300'
                    }`}
                  >
                    <Mic className="w-3.5 h-3.5" /> {isListening ? 'Listening...' : 'Transcribe Speaker'}
                  </button>
                </div>
                <p className="text-sm text-zinc-200 font-medium min-h-[24px]">
                  {liveTranscript || 'Tap "Transcribe Speaker" to convert nearby speech into live text...'}
                </p>
              </div>
            )}
          </div>
        </div>

        {activeTab === 'sign_bridge' && (
          <div className="glass-panel rounded-3xl p-6 space-y-5">
            <div>
              <h3 className="font-serif-display text-2xl text-white">Quick Phrase & Gesture Cards</h3>
              <p className="text-xs text-zinc-400">Tap any saved card to speak it aloud immediately</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {gestures.map((g) => (
                <button
                  key={g.id}
                  onClick={() => {
                    setAiResult({ en: g.spoken_phrase_en, hazard: false });
                    speakText(g.spoken_phrase_en, true);
                  }}
                  className="p-4 rounded-2xl glass-card text-left group cursor-pointer"
                >
                  <p className="font-semibold text-amber-300 text-sm group-hover:text-amber-200">
                    {g.gesture_name}
                  </p>
                  <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{g.spoken_phrase_en}</p>
                </button>
              ))}
            </div>

            <form onSubmit={handleSaveGesture} className="grid sm:grid-cols-3 gap-3 pt-4 border-t border-white/[0.07]">
              <input
                type="text" placeholder="Card Title (e.g., Medical Help)" required
                className="px-4 py-3 rounded-xl bg-zinc-900/90 border border-white/10 text-sm text-white placeholder-zinc-500"
                value={newGesture.gesture_name} onChange={(e) => setNewGesture({ ...newGesture, gesture_name: e.target.value })}
              />
              <input
                type="text" placeholder="Spoken Sentence (e.g., I need assistance please)" required
                className="px-4 py-3 rounded-xl bg-zinc-900/90 border border-white/10 text-sm text-white placeholder-zinc-500"
                value={newGesture.spoken_phrase_en} onChange={(e) => setNewGesture({ ...newGesture, spoken_phrase_en: e.target.value })}
              />
              <button
                type="submit"
                className="py-3 bg-white text-zinc-950 hover:bg-amber-300 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Add Quick Card
              </button>
            </form>
          </div>
        )}

        <div className="glass-panel rounded-3xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <History className="w-5 h-5 text-amber-400" />
              <h3 className="font-serif-display text-2xl text-white">Sensory Log & Route History</h3>
            </div>
            <span className="text-xs text-zinc-500">{history.length} entries</span>
          </div>

          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {history.length === 0 ? (
              <p className="text-sm text-zinc-500 py-4 text-center">
                Your outdoor route guidance and analyzed scans will appear here.
              </p>
            ) : (
              history.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-2xl bg-zinc-900/60 border border-white/[0.06] hover:border-white/15 flex justify-between items-center gap-4 transition"
                >
                  <div className="space-y-1">
                    <span className="inline-block text-[10px] uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 font-semibold">
                      {item.feature_type.replace('_', ' ')}
                    </span>
                    <p className="text-sm text-zinc-200 leading-relaxed">{item.ai_response_en}</p>
                  </div>
                  <button
                    onClick={() => speakText(item.ai_response_en, true)}
                    className="p-2.5 rounded-xl bg-white/[0.05] hover:bg-amber-400 hover:text-zinc-950 text-zinc-300 transition shrink-0 cursor-pointer"
                    title="Play Audio"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}