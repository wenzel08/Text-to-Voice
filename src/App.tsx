import { useState, useRef, useEffect, useMemo } from "react";
import { 
  Play, 
  Pause, 
  Download, 
  Volume2, 
  RotateCcw, 
  VolumeX, 
  Sparkles, 
  Heart, 
  Check, 
  AlertCircle, 
  Mic, 
  ShieldAlert,
  Sliders,
  Award
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Predefined voices available in gemini-3.1-flash-tts-preview
interface VoiceOption {
  id: string;
  name: string;
  gender: "male" | "female";
  description: string;
  avatar: string;
}

const VOICES: VoiceOption[] = [
  { id: "Charon", name: "Charon", gender: "male", description: "Deep, resonant, and formal narrative style", avatar: "👨‍💼" },
  { id: "Fenrir", name: "Fenrir", gender: "male", description: "Deep, crisp, classic speaker style", avatar: "🧔" },
  { id: "Puck", name: "Puck", gender: "male", description: "Warm, conversational, and energetic style", avatar: "👦" },
  { id: "Zephyr", name: "Zephyr", gender: "female", description: "Soft, warm, and comforting tone", avatar: "👩" },
  { id: "Kore", name: "Kore", gender: "female", description: "Bright, professional, and clear tone", avatar: "👩‍💼" },
];

const SPEEDS = [
  { id: "slow", label: "Slow", desc: "For extreme clarity" },
  { id: "normal_slow", label: "Normal to Slow", desc: "Comfortable pacing" },
  { id: "normal", label: "Normal", desc: "Standard speech rate" },
  { id: "fast", label: "Fast", desc: "Energetic narration" },
];

export default function App() {
  // Pre-loaded text requested by the user
  const defaultText = `So, do you want to be a hero today? Well, there is a great need for blood donations around the world, and you can be the means of saving lives. According to the American Red Cross, over 40,000 blood donations are needed every single day in the United States alone, and without the help of volunteers like you, it is impossible to fill this need. About 9.2 million people donate every year in the US, and although approximately 38% of the population is eligible to donate, less than 10% of them actually do.

Sometimes people don’t donate out of fear, but the process is relatively simple following a four-step process: registering, getting your medical history checked, donating, and then having some refreshments*. And once you donate, you have the ability to donate red blood cells every 56 days.

So, carefully consider becoming a hero today. Donate blood and you can save lives.`;

  const [text, setText] = useState(defaultText);
  const [selectedVoice, setSelectedVoice] = useState<string>("Charon"); // Default male voice
  const [selectedSpeed, setSelectedSpeed] = useState<string>("normal_slow"); // Default requested speed
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Audio Engine state
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [wavBlob, setWavBlob] = useState<Blob | null>(null);
  const [generationCount, setGenerationCount] = useState(0);

  // Refs for Web Audio API
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Playback timer refs
  const playStartCtxTimeRef = useRef<number>(0);
  const playStartOffsetRef = useRef<number>(0);
  const timerIntervalRef = useRef<number | null>(null);
  const decodedAudioBufferRef = useRef<AudioBuffer | null>(null);
  const rawPcmDataRef = useRef<Int16Array | null>(null);

  // Highlight words
  const wordsArray = useMemo(() => {
    return text.trim().split(/\s+/).filter(w => w.length > 0);
  }, [text]);

  const currentWordIndex = useMemo(() => {
    if (!isPlaying || duration === 0) return -1;
    const progress = currentTime / duration;
    const index = Math.floor(progress * wordsArray.length);
    return Math.min(wordsArray.length - 1, Math.max(0, index));
  }, [currentTime, duration, isPlaying, wordsArray]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  // Set gain/volume whenever volume or mute state changes
  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      const targetVolume = isMuted ? 0 : volume;
      gainNodeRef.current.gain.setValueAtTime(targetVolume, audioCtxRef.current.currentTime);
    }
  }, [volume, isMuted]);

  // Generate real-time waveform visualizer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let localFrame: number;
    const bufferLength = analyserNodeRef.current ? analyserNodeRef.current.frequencyBinCount : 128;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      localFrame = requestAnimationFrame(draw);
      
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Background grid
      ctx.strokeStyle = "rgba(239, 68, 68, 0.05)";
      ctx.lineWidth = 1;
      for (let i = 20; i < width; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, height);
        ctx.stroke();
      }
      for (let i = 15; i < height; i += 30) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(width, i);
        ctx.stroke();
      }

      if (isPlaying && analyserNodeRef.current) {
        // Draw real-time frequencies
        analyserNodeRef.current.getByteTimeDomainData(dataArray);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#dc2626"; // Crimson
        ctx.beginPath();

        const sliceWidth = width / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * height) / 2;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }

          x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Draw double pulse ring/bars for ambient design
        ctx.fillStyle = "rgba(220, 38, 38, 0.1)";
        ctx.beginPath();
        let barWidth = 4;
        let spacing = 6;
        let bars = Math.floor(width / (barWidth + spacing));
        for (let j = 0; j < bars; j++) {
          const dataIndex = Math.floor((j / bars) * bufferLength);
          const rawVal = dataArray[dataIndex] - 128;
          const mag = Math.abs(rawVal) * 1.5;
          ctx.fillRect(j * (barWidth + spacing), height / 2 - mag, barWidth, mag * 2);
        }
      } else {
        // Draw elegant standby sinusoidal wave
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(220, 38, 38, 0.25)";
        ctx.beginPath();
        const t = Date.now() * 0.003;
        for (let x = 0; x < width; x++) {
          const y = height / 2 + Math.sin(x * 0.015 + t) * 12 * Math.sin(x * 0.002);
          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(localFrame);
    };
  }, [isPlaying]);

  // WAV file generator helper (16-bit PCM Mono WAV)
  const generateWavFile = (pcmData: Int16Array, sampleRate: number): Blob => {
    const buffer = new ArrayBuffer(44 + pcmData.length * 2);
    const view = new DataView(buffer);

    const writeString = (view: DataView, offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    /* RIFF identifier */
    writeString(view, 0, "RIFF");
    /* file length */
    view.setUint32(4, 36 + pcmData.length * 2, true);
    /* RIFF type */
    writeString(view, 8, "WAVE");
    /* format chunk identifier */
    writeString(view, 12, "fmt ");
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (1 = raw integer PCM) */
    view.setUint16(20, 1, true);
    /* channel count (mono) */
    view.setUint16(22, 1, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, sampleRate * 2, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, 2, true);
    /* bits per sample (16-bit) */
    view.setUint16(34, 16, true);
    /* data chunk identifier */
    writeString(view, 36, "data");
    /* data chunk length */
    view.setUint32(40, pcmData.length * 2, true);

    // Write PCM samples
    for (let i = 0; i < pcmData.length; i++) {
      view.setInt16(44 + i * 2, pcmData[i], true);
    }

    return new Blob([view], { type: "audio/wav" });
  };

  // Convert Base64 raw audio payload to float and decode for Web Audio Context
  const loadAudioBuffer = async (base64Str: string) => {
    try {
      // Decode base64 to binary
      const binaryStr = window.atob(base64Str);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Convert Uint8Array to 16-bit signed integer buffer
      const numSamples = len / 2;
      const int16Data = new Int16Array(bytes.buffer);
      rawPcmDataRef.current = int16Data;

      // Normalize int16 (-32768 to 32767) to Float32 (-1.0 to 1.0)
      const float32Data = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        float32Data[i] = int16Data[i] / 32768.0;
      }

      // Prepare Web Audio Context
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 24000
        });
      }

      const audioCtx = audioCtxRef.current;
      const sampleRate = 24000;
      const audioBuffer = audioCtx.createBuffer(1, numSamples, sampleRate);
      audioBuffer.getChannelData(0).set(float32Data);

      decodedAudioBufferRef.current = audioBuffer;
      setDuration(audioBuffer.duration);
      setCurrentTime(0);

      // Generate a downloadable WAV blob as well
      const blob = generateWavFile(int16Data, sampleRate);
      setWavBlob(blob);
    } catch (err) {
      console.error("Failed to decode audio base64:", err);
      setError("Failed to process generated speech file.");
    }
  };

  // Generate TTS Audio via server-side endpoint
  const handleGenerateSpeech = async () => {
    if (!text.trim()) {
      setError("Please input some text to speak.");
      return;
    }

    setIsLoading(true);
    setError(null);
    stopAudio();

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: selectedVoice,
          speed: selectedSpeed,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate speech.");
      }

      if (data.audio) {
        setAudioBase64(data.audio);
        await loadAudioBuffer(data.audio);
        setGenerationCount(prev => prev + 1);
        
        // Auto play on successful generation!
        setTimeout(() => {
          playAudio(0);
        }, 100);
      } else {
        throw new Error("No audio returned from server.");
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred. Please verify your connection or API key.");
    } finally {
      setIsLoading(false);
    }
  };

  // Play audio from specific offset
  const playAudio = (offset = 0) => {
    if (!decodedAudioBufferRef.current) return;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const audioCtx = audioCtxRef.current;
    
    // Resume context if suspended (browser security restriction)
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    // Stop current source if any
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) {}
    }

    // Create a chain: Source -> GainNode -> Analyser -> Destination
    const source = audioCtx.createBufferSource();
    source.buffer = decodedAudioBufferRef.current;

    if (!gainNodeRef.current) {
      gainNodeRef.current = audioCtx.createGain();
    }
    if (!analyserNodeRef.current) {
      analyserNodeRef.current = audioCtx.createAnalyser();
      analyserNodeRef.current.fftSize = 256;
    }

    const gainNode = gainNodeRef.current;
    const analyserNode = analyserNodeRef.current;

    // Connect nodes
    source.connect(gainNode);
    gainNode.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);

    // Set initial volume
    gainNode.gain.setValueAtTime(isMuted ? 0 : volume, audioCtx.currentTime);

    // Setup source playing params
    sourceNodeRef.current = source;
    playStartCtxTimeRef.current = audioCtx.currentTime;
    playStartOffsetRef.current = offset;

    // Start playing at designated offset
    source.start(0, offset);
    setIsPlaying(true);

    // Update progress state
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = window.setInterval(() => {
      const elapsed = audioCtx.currentTime - playStartCtxTimeRef.current;
      const current = playStartOffsetRef.current + elapsed;
      if (current >= decodedAudioBufferRef.current!.duration) {
        setCurrentTime(decodedAudioBufferRef.current!.duration);
        setIsPlaying(false);
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      } else {
        setCurrentTime(current);
      }
    }, 50);

    // Event on ended
    source.onended = () => {
      // Confirm if it ended naturally or was stopped
      const elapsed = audioCtx.currentTime - playStartCtxTimeRef.current;
      const current = playStartOffsetRef.current + elapsed;
      if (current >= (decodedAudioBufferRef.current?.duration || 0) - 0.05) {
        setIsPlaying(false);
        setCurrentTime(decodedAudioBufferRef.current?.duration || 0);
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      }
    };
  };

  // Pause audio playback
  const pauseAudio = () => {
    if (!isPlaying) return;
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) {}
    }
    setIsPlaying(false);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
  };

  // Stop completely & reset
  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) {}
    }
    setIsPlaying(false);
    setCurrentTime(0);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
  };

  // Trigger Play or Pause
  const handlePlayPause = () => {
    if (!audioBase64) {
      handleGenerateSpeech();
      return;
    }

    if (isPlaying) {
      pauseAudio();
    } else {
      if (currentTime >= duration) {
        playAudio(0);
      } else {
        playAudio(currentTime);
      }
    }
  };

  const handleDownload = () => {
    if (!wavBlob) return;
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blood_donor_speech_${selectedVoice.toLowerCase()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatTime = (timeInSec: number) => {
    const mins = Math.floor(timeInSec / 60);
    const secs = Math.floor(timeInSec % 60);
    const tenths = Math.floor((timeInSec % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, "0")}.${tenths}`;
  };

  return (
    <div className="min-h-screen bg-[#faf9f6] text-zinc-900 font-sans transition-all duration-300">
      {/* Background soft lighting overlays */}
      <div className="absolute top-0 right-1/4 w-[40rem] h-[40rem] bg-rose-100/30 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="absolute bottom-0 left-10 w-[30rem] h-[30rem] bg-orange-100/20 rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Main Header */}
      <header className="border-b border-zinc-200/60 bg-white/80 backdrop-blur-md sticky top-0 z-40 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-red-600 text-white p-2.5 rounded-2xl shadow-md shadow-red-200/50 flex items-center justify-center">
              <Heart className="w-6 h-6 fill-white stroke-red-600 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-red-600 tracking-wider uppercase bg-red-50 px-2 py-0.5 rounded-md">
                  Vocal Engine
                </span>
              </div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-zinc-950">
                Blood Donor Speech Studio
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="bg-zinc-100 px-3 py-1.5 rounded-full text-xs font-medium text-zinc-600 flex items-center gap-2 border border-zinc-200/50">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-ping" />
              <span>Gemini 3.1 TTS Activated</span>
            </div>
          </div>
        </div>
      </header>

      {/* Workspace Grid */}
      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Speech Config & Inputs */}
        <section className="lg:col-span-7 flex flex-col gap-6">
          
          {/* Main Speech Input Card */}
          <div className="bg-white rounded-3xl border border-zinc-200/80 shadow-sm p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div className="flex items-center gap-2">
                <Mic className="w-5 h-5 text-red-600" />
                <h2 className="font-display font-bold text-lg text-zinc-900">Configure Narration Text</h2>
              </div>
              <button
                onClick={() => setText(defaultText)}
                className="text-xs font-semibold text-zinc-500 hover:text-red-600 transition-colors flex items-center gap-1 bg-zinc-50 hover:bg-red-50/50 px-2.5 py-1 rounded-lg border border-zinc-100"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Text
              </button>
            </div>

            <div className="relative">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type or paste the speech you would like to generate..."
                className="w-full h-80 bg-zinc-50/50 border border-zinc-200 focus:border-red-500 focus:ring focus:ring-red-100 rounded-2xl p-4 text-zinc-800 leading-relaxed text-sm resize-none transition-all outline-none font-sans"
              />
              <div className="absolute bottom-3 right-3 bg-white/90 border border-zinc-100 px-2.5 py-1 rounded-lg text-[11px] font-mono text-zinc-500">
                {text.length} chars • {wordsArray.length} words
              </div>
            </div>
          </div>

          {/* Voice Configuration Bento Card */}
          <div className="bg-white rounded-3xl border border-zinc-200/80 shadow-sm p-6 flex flex-col gap-5">
            <div className="flex items-center gap-2 border-b border-zinc-100 pb-3">
              <Sliders className="w-5 h-5 text-red-600" />
              <h2 className="font-display font-bold text-lg text-zinc-900">Narrator & Speed Selection</h2>
            </div>

            {/* Narrator Voice Grid */}
            <div className="flex flex-col gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Choose Narrator Voice
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {VOICES.map((v) => {
                  const isSelected = selectedVoice === v.id;
                  return (
                    <button
                      key={v.id}
                      onClick={() => {
                        setSelectedVoice(v.id);
                        // Invalidate generated audio if voice changes
                        setAudioBase64(null);
                        setWavBlob(null);
                        stopAudio();
                      }}
                      className={`text-left p-3.5 rounded-2xl border transition-all flex items-start gap-3 relative overflow-hidden ${
                        isSelected 
                          ? "border-red-600 bg-red-50/30 ring-1 ring-red-600 shadow-sm" 
                          : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50/50"
                      }`}
                    >
                      <span className="text-2xl bg-white p-1 rounded-xl shadow-sm border border-zinc-100 select-none">
                        {v.avatar}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sm text-zinc-900">{v.name}</span>
                          <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-mono font-semibold ${
                            v.gender === 'male' ? 'bg-blue-50 text-blue-600' : 'bg-pink-50 text-pink-600'
                          }`}>
                            {v.gender}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-500 mt-1 line-clamp-2 leading-snug">
                          {v.description}
                        </p>
                      </div>

                      {isSelected && (
                        <div className="absolute top-2 right-2 bg-red-600 text-white rounded-full p-0.5">
                          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Speed selection */}
            <div className="flex flex-col gap-3 mt-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Speech Speed Rate
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {SPEEDS.map((sp) => {
                  const isSelected = selectedSpeed === sp.id;
                  return (
                    <button
                      key={sp.id}
                      onClick={() => {
                        setSelectedSpeed(sp.id);
                        // Invalidate generated audio if speed changes
                        setAudioBase64(null);
                        setWavBlob(null);
                        stopAudio();
                      }}
                      className={`p-2.5 rounded-xl border text-center transition-all ${
                        isSelected
                          ? "border-red-600 bg-red-50/30 text-red-700 font-bold"
                          : "border-zinc-200 hover:border-zinc-300 text-zinc-600 hover:bg-zinc-50/50"
                      }`}
                    >
                      <div className="text-xs font-semibold">{sp.label}</div>
                      <div className="text-[9px] text-zinc-400 font-normal mt-0.5">{sp.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

        </section>

        {/* Right Column: Playback & Visualization */}
        <section className="lg:col-span-5 flex flex-col gap-6">

          {/* Core Player Bento Box */}
          <div className="bg-white rounded-3xl border border-zinc-200/80 shadow-md p-6 flex flex-col gap-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-red-50 rounded-bl-full pointer-events-none -z-10 opacity-60" />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-red-600 animate-pulse" />
                <h2 className="font-display font-bold text-lg text-zinc-950">Audio Playback Hub</h2>
              </div>
              {audioBase64 && (
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                  Generated Successfully
                </span>
              )}
            </div>

            {/* Render wave element / audio visualization canvas */}
            <div className="bg-zinc-900 rounded-2xl p-4 flex flex-col gap-2 shadow-inner border border-zinc-800">
              <div className="flex items-center justify-between text-zinc-400 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span>Real-time Waveform</span>
                </div>
                <div>{audioBase64 ? "24kHz Mono Int16" : "No Audio Loaded"}</div>
              </div>

              <canvas 
                ref={canvasRef} 
                width={360} 
                height={96} 
                className="w-full h-24 rounded-lg bg-zinc-950/80"
              />

              <div className="flex items-center justify-between font-mono text-xs mt-1 text-zinc-300">
                <span>{formatTime(currentTime)}</span>
                <span className="text-zinc-500">/</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Trigger Button or Control Suite */}
            {!audioBase64 ? (
              <button
                onClick={handleGenerateSpeech}
                disabled={isLoading || !text.trim()}
                className={`w-full py-4 px-6 rounded-2xl font-semibold flex items-center justify-center gap-3 transition-all ${
                  isLoading
                    ? "bg-zinc-100 text-zinc-400 border border-zinc-200 cursor-not-allowed"
                    : "bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-200 cursor-pointer hover:-translate-y-0.5 active:translate-y-0"
                }`}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-zinc-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Synthesizing Male Voice...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 fill-white" />
                    <span>Generate & Speak Now</span>
                  </>
                )}
              </button>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Control sliders & action buttons */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handlePlayPause}
                    className="w-14 h-14 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center shadow-md shadow-red-100 transition-transform active:scale-95 cursor-pointer"
                  >
                    {isPlaying ? <Pause className="w-6 h-6 fill-white" /> : <Play className="w-6 h-6 fill-white ml-0.5" />}
                  </button>

                  <button
                    onClick={stopAudio}
                    className="w-11 h-11 bg-zinc-100 hover:bg-zinc-200/80 border border-zinc-200 text-zinc-700 rounded-full flex items-center justify-center transition-all"
                    title="Stop Audio"
                  >
                    <RotateCcw className="w-5 h-5" />
                  </button>

                  {/* Volume Control */}
                  <div className="flex-1 bg-zinc-50 border border-zinc-200/60 rounded-full px-4 py-2.5 flex items-center gap-3">
                    <button onClick={() => setIsMuted(!isMuted)} className="text-zinc-600 hover:text-zinc-950">
                      {isMuted || volume === 0 ? <VolumeX className="w-4.5 h-4.5" /> : <Volume2 className="w-4.5 h-4.5" />}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={volume}
                      onChange={(e) => {
                        setVolume(parseFloat(e.target.value));
                        setIsMuted(false);
                      }}
                      className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-red-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-1">
                  <button
                    onClick={handleDownload}
                    className="py-3 px-4 rounded-xl font-semibold border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <Download className="w-4 h-4 text-zinc-500" />
                    Download WAV
                  </button>
                  <button
                    onClick={handleGenerateSpeech}
                    disabled={isLoading}
                    className="py-3 px-4 rounded-xl font-semibold bg-zinc-900 hover:bg-zinc-950 text-white text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4 text-red-500" />
                    Regenerate
                  </button>
                </div>
              </div>
            )}

            {/* Error state display */}
            <AnimatePresence>
              {error && (() => {
                const isHighDemand = error.toLowerCase().includes("demand") || 
                                    error.toLowerCase().includes("temporary") || 
                                    error.toLowerCase().includes("busy") || 
                                    error.toLowerCase().includes("unavailable") ||
                                    error.toLowerCase().includes("503") ||
                                    error.toLowerCase().includes("limit");
                
                return (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className={`p-4 rounded-2xl flex items-start gap-3 mt-2 border ${
                      isHighDemand 
                        ? "bg-amber-50 border-amber-200 text-amber-800" 
                        : "bg-red-50 border-red-200 text-red-700"
                    }`}
                  >
                    <AlertCircle className={`w-5 h-5 shrink-0 mt-0.5 ${isHighDemand ? "text-amber-500" : "text-red-500"}`} />
                    <div className="text-xs leading-normal">
                      <p className="font-bold">{isHighDemand ? "Server Busy (High Demand)" : "Generation Error"}</p>
                      <p className={`mt-0.5 ${isHighDemand ? "text-amber-700" : "text-red-600"}`}>{error}</p>
                      
                      {isHighDemand ? (
                        <p className="mt-2 text-[10px] text-amber-600 bg-white/50 p-2 rounded border border-amber-100">
                          Your API Key is <strong>configured correctly</strong>! However, Google's public TTS preview model is currently experiencing heavy traffic. Please wait a few seconds and click <strong>Regenerate</strong> or <strong>Generate & Speak</strong> to retry.
                        </p>
                      ) : (
                        <p className="mt-2 text-[10px] text-red-500 bg-white/50 p-2 rounded border border-red-100">
                          Verify your environment has <code className="font-mono bg-zinc-50 px-1 py-0.5 rounded">GEMINI_API_KEY</code> set in settings.
                        </p>
                      )}
                    </div>
                  </motion.div>
                );
              })()}
            </AnimatePresence>
          </div>

          {/* Live Highlighting Reader Box */}
          <div className="bg-white rounded-3xl border border-zinc-200/80 shadow-sm p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-red-600" />
                <h2 className="font-display font-bold text-lg text-zinc-900">Word Play-Along Tracker</h2>
              </div>
              <span className="text-xs font-mono text-zinc-400">
                {currentWordIndex >= 0 ? `${currentWordIndex + 1} / ${wordsArray.length} words` : "Standby"}
              </span>
            </div>

            <div className="h-60 overflow-y-auto pr-2 scrollbar-thin text-zinc-600 text-sm leading-relaxed font-sans bg-zinc-50/50 p-4 rounded-2xl border border-zinc-100">
              {wordsArray.length === 0 ? (
                <span className="text-zinc-400 italic">No text provided to highlight.</span>
              ) : (
                <div className="flex flex-wrap gap-x-1.5 gap-y-2">
                  {wordsArray.map((word, idx) => {
                    const isCurrent = currentWordIndex === idx;
                    const isSpoken = idx < currentWordIndex;
                    return (
                      <span
                        key={idx}
                        className={`transition-all duration-150 px-1 py-0.5 rounded-md ${
                          isCurrent
                            ? "bg-red-600 text-white font-bold scale-105 shadow-sm shadow-red-200"
                            : isSpoken
                            ? "text-zinc-400 border-b border-zinc-200"
                            : "text-zinc-800"
                        }`}
                      >
                        {word}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            
            {/* Quick Context Card */}
            <div className="bg-red-50/20 border border-red-100 p-4 rounded-2xl flex items-start gap-3 mt-1">
              <div className="bg-red-100 text-red-700 p-1 rounded-xl">
                <Heart className="w-4 h-4 fill-red-600 stroke-red-600" />
              </div>
              <div className="text-xs text-zinc-600 leading-relaxed">
                <span className="font-bold text-zinc-800 block mb-0.5">Blood Donation Fact Check</span>
                Over 40,000 blood donations are required daily. Voluntarism represents a highly impactful mechanism to actively save countless lives worldwide.
              </div>
            </div>
          </div>

        </section>

      </main>

      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-zinc-200/50 mt-12 text-center text-zinc-400 text-xs font-mono">
        <p>© 2026 Blood Donor Speech Generator. All rights reserved.</p>
        <p className="mt-1">Powered by Google Gemini 3.1 & Cloud Run Infrastructure.</p>
      </footer>
    </div>
  );
}
