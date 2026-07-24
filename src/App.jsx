// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Pause, 
  Upload, 
  Trash2, 
  Download, 
  Save, 
  RefreshCw, 
  Plus, 
  Volume2, 
  VolumeX,
  Sparkles,
  FolderOpen,
  PlusCircle,
  Link,
  ChevronUp,
  ChevronDown,
  Sliders,
  Share2,
  Calendar,
  Clock,
  Video,
  CheckCircle,
  AlertCircle,
  Palette,
  Eye,
  EyeOff,
  Copy,
  Check,
  Key
} from 'lucide-react';
import { drawFrame } from './utils/canvasRenderer';
import { exportVideo } from './utils/videoExporter';
import { saveAudioToStorage, getAudioFromStorage, clearAudioFromStorage, saveImageToStorage, getImageFromStorage, clearImagesFromStorage, deleteImageFromStorage, saveVideoToStorage, getVideoFromStorage } from './utils/audioStorage';

// Default prompt script replicating FastScene layout
const DEFAULT_SCRIPT = `Đây là khách quan.
Đây là chủ quan.
Sự khác nhau là gì?
Khách quan là góc nhìn nhìn nhận sự việc đúng như bản chất thực tế đang diễn ra, không bị ảnh hưởng bởi cảm xúc hay định kiến cá nhân.
Chủ quan là góc nhìn xuất phát từ ý muốn, cảm xúc, kinh nghiệm và quan điểm riêng của một cá nhân hoặc một nhóm người.

Đây là trí tuệ nhân tạo.
Đây là trí tuệ con người.
Sự khác nhau là gì?
Trí tuệ nhân tạo xử lý dữ liệu với tốc độ cực nhanh và chính xác dựa trên các thuật toán cùng mô hình được lập trình sẵn.
Trí tuệ con người sở hữu sự thấu cảm, ý thức, khả năng tư duy phản biện và sự sáng tạo vượt ra ngoài những quy tắc có sẵn.`;

// Safe base64 decoding helper function to prevent InvalidCharacterError crashes
const safeAtob = (str) => {
  if (!str || typeof atob !== 'function') return '';
  try {
    let padded = str;
    const mod = str.length % 4;
    if (mod > 0) {
      padded += '='.repeat(4 - mod);
    }
    return atob(padded);
  } catch (e) {
    console.warn('safeAtob decode skipped:', e);
    return '';
  }
};

// A reusable component to render password-type input fields with view eye toggle and copy button
const ApiKeyInput = ({ value, onChange, placeholder = "Nhập API Key...", className = "", style = {}, ...props }) => {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', position: 'relative' }}>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={className}
        style={{
          flex: 1,
          paddingRight: '65px',
          width: '100%',
          ...style
        }}
        {...props}
      />
      <div style={{
        position: 'absolute',
        right: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px'
      }}>
        <button
          type="button"
          onClick={() => setShow(!show)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted, #94a3b8)',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.2s'
          }}
          title={show ? "Ẩn Key" : "Hiện Key"}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!value}
          style={{
            background: 'none',
            border: 'none',
            color: copied ? 'var(--accent-emerald, #10b981)' : 'var(--text-muted, #94a3b8)',
            cursor: value ? 'pointer' : 'not-allowed',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.2s',
            opacity: value ? 1 : 0.5
          }}
          title={copied ? "Đã sao chép!" : "Sao chép"}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
    </div>
  );
};

// Helper phân tích danh sách key VClip từ chuỗi dạng: key | YYYY-MM-DD | status
const parseVclipKeyText = (rawText) => {
  if (!rawText) return [];
  const lines = rawText.split('\n');
  const nowStr = new Date().toISOString().split('T')[0];
  const items = [];
  
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split('|').map(p => p.trim());
    const key = parts[0];
    if (!key) return;

    let dateStr = parts[1] || nowStr;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      dateStr = nowStr;
    }

    let status = (parts[2] || 'active').toLowerCase();
    if (status !== 'exhausted') status = 'active';

    items.push({
      key,
      createdDate: dateStr,
      status
    });
  });

  return items;
};

// Helper xuất ngược danh sách VClip Key ra dạng chuỗi text
const formatVclipKeyItems = (items) => {
  if (!items || items.length === 0) return '';
  return items.map(item => {
    if (item.status === 'exhausted') {
      return `${item.key} | ${item.createdDate || new Date().toISOString().split('T')[0]} | exhausted`;
    }
    return `${item.key} | ${item.createdDate || new Date().toISOString().split('T')[0]}`;
  }).join('\n');
};

// Helper tính toán số ngày còn lại đến chu kỳ reset 30 ngày (1 tháng)
const getVclipKeyStatusInfo = (item) => {
  if (!item || !item.key) return { isUsable: false, daysLeft: 30, resetDateStr: '' };
  const now = new Date();
  const created = new Date(item.createdDate || now);
  const resetDate = new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);
  const daysLeft = Math.ceil((resetDate - now) / (1000 * 60 * 60 * 24));
  
  const isExpiredPeriodDone = daysLeft <= 0;
  const isUsable = item.status !== 'exhausted' || isExpiredPeriodDone;

  return {
    isUsable,
    daysLeft: Math.max(0, daysLeft),
    resetDateStr: resetDate.toISOString().split('T')[0]
  };
};

const DEFAULT_ELEVEN_VOICES = [
  { voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (Nữ - Mỹ)' },
  { voice_id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi (Nữ - Truyền cảm)' },
  { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (Nữ - Nhẹ nhàng)' },
  { voice_id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (Nam - Trầm ấm)' },
  { voice_id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli (Nữ - Trẻ trung)' },
  { voice_id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh (Nam - Sôi nổi)' },
  { voice_id: 'VR6AewLTigWG4xTVO1Vp', name: 'Arnold (Nam - Mạnh mẽ)' },
  { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam (Nam - Thuyết minh)' }
];

const DEFAULT_COMPARISONS = [
  {
    id: 'comp-1',
    leftTitle: 'Khách quan',
    leftImageUrl: '',
    leftZoom: 100,
    leftColor: '#d93025', // Red
    rightTitle: 'Chủ quan',
    rightImageUrl: '',
    rightZoom: 100,
    rightColor: '#1b5e20', // Green
    startIndex: 0
  },
  {
    id: 'comp-2',
    leftTitle: 'Trí tuệ nhân tạo',
    leftImageUrl: '',
    leftZoom: 100,
    leftColor: '#d93025',
    rightTitle: 'Trí tuệ con người',
    rightImageUrl: '',
    rightZoom: 100,
    rightColor: '#1b5e20',
    startIndex: 5
  }
];

const DEFAULT_TIMELINE = [
  { id: 't-1', start: 0.0, end: 2.5, text: 'Đây là khách quan.', pose: 'point_left', highlight: 'left' },
  { id: 't-2', start: 2.5, end: 5.0, text: 'Đây là chủ quan.', pose: 'point_right', highlight: 'right' },
  { id: 't-3', start: 5.0, end: 7.2, text: 'Sự khác nhau là gì?', pose: 'shrug', highlight: 'none' },
  { id: 't-4', start: 7.2, end: 17.5, text: 'Khách quan là góc nhìn nhìn nhận sự việc đúng như bản chất thực tế đang diễn ra, không bị ảnh hưởng bởi cảm xúc hay định kiến cá nhân.', pose: 'point_left', highlight: 'left' },
  { id: 't-5', start: 17.5, end: 28.0, text: 'Chủ quan là góc nhìn xuất phát từ ý muốn, cảm xúc, kinh nghiệm và quan điểm riêng của một cá nhân hoặc một nhóm người.', pose: 'point_right', highlight: 'right' },
  { id: 't-6', start: 28.0, end: 30.5, text: 'Đây là trí tuệ nhân tạo.', pose: 'point_left', highlight: 'left' },
  { id: 't-7', start: 30.5, end: 33.0, text: 'Đây là trí tuệ con người.', pose: 'point_right', highlight: 'right' },
  { id: 't-8', start: 33.0, end: 35.2, text: 'Sự khác nhau là gì?', pose: 'shrug', highlight: 'none' },
  { id: 't-9', start: 35.2, end: 45.0, text: 'Trí tuệ nhân tạo xử lý dữ liệu với tốc độ cực nhanh và chính xác dựa trên các thuật toán cùng mô hình được lập trình sẵn.', pose: 'point_left', highlight: 'left' },
  { id: 't-10', start: 45.0, end: 56.0, text: 'Trí tuệ con người sở hữu sự thấu cảm, ý thức, khả năng tư duy phản biện và sự sáng tạo vượt ra ngoài những quy tắc có sẵn.', pose: 'point_right', highlight: 'right' }
];

// Reusable File Upload Dropzone Component with Drag and Drop Support
const FileUploadDropzone = ({ accept = "image/*", onChange, children, className = "file-upload-wrapper", style }) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const fakeEvent = {
        target: {
          files: [file]
        }
      };
      onChange(fakeEvent);
    }
  };

  return (
    <div 
      className={`${className} ${isDragOver ? 'drag-over' : ''}`}
      style={{ 
        ...style,
        position: 'relative',
        transition: 'all 0.2s ease',
        borderRadius: '6px',
        boxShadow: isDragOver ? '0 0 10px rgba(99, 102, 241, 0.5)' : 'none',
        border: isDragOver ? '2px dashed var(--primary)' : 'none',
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      <input 
        type="file" 
        accept={accept} 
        className="file-upload-input" 
        onChange={onChange} 
      />
    </div>
  );
};

export default function App() {
  // Ngăn chặn sự kiện drop mặc định của trình duyệt để tránh bị chuyển hướng trang (browser navigate)
  useEffect(() => {
    const preventDefault = (e) => e.preventDefault();
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);
    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

  // Navigation Tabs: 'content' (Nội dung) | 'timeline' (Pose & hành động) | 'tts' (Tạo voice)
  const [activeTab, setActiveTab] = useState('content');

  // General Setup
  const [headerTitle, setHeaderTitle] = useState(() => localStorage.getItem('headerTitle') || 'Mèo Thông Thái');
  const [customFilename, setCustomFilename] = useState(() => localStorage.getItem('customFilename') || 'so_sanh_meo_thong_thai');
  const [headerLogoUrl, setHeaderLogoUrl] = useState(() => localStorage.getItem('headerLogoUrl') || '');
  const [logoFileName, setLogoFileName] = useState(() => localStorage.getItem('logoFileName') || '');
  const [bgColor, setBgColor] = useState(() => localStorage.getItem('bgColor') || '#FAF6F0');
  const [headerPosition, setHeaderPosition] = useState(() => localStorage.getItem('headerPosition') || 'top-center');
  const [headerTitleColor, setHeaderTitleColor] = useState(() => localStorage.getItem('headerTitleColor') || '#4A3E3D');
  const [headerTitleFontSize, setHeaderTitleFontSize] = useState(() => {
    const saved = localStorage.getItem('headerTitleFontSize');
    return saved !== null ? parseInt(saved, 10) : 28;
  });

  // Comparisons and Timeline States
  const [comparisons, setComparisons] = useState(() => {
    try {
      const saved = localStorage.getItem('comparisons');
      return saved ? JSON.parse(saved) : DEFAULT_COMPARISONS;
    } catch {
      return DEFAULT_COMPARISONS;
    }
  });
  const [timelineBlocks, setTimelineBlocks] = useState(() => {
    try {
      const saved = localStorage.getItem('timelineBlocks');
      return saved ? JSON.parse(saved) : DEFAULT_TIMELINE;
    } catch {
      return DEFAULT_TIMELINE;
    }
  });
  const [scriptText, setScriptText] = useState(() => localStorage.getItem('scriptText') || DEFAULT_SCRIPT);

  // Mascot Custom Poses
  const [mascotPoses, setMascotPoses] = useState(() => {
    try {
      const saved = localStorage.getItem('mascotPoses');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn(e);
    }
    const activeId = localStorage.getItem('active_channel_id') || 'cat-thong-thai';
    if (activeId === 'cat-thong-thai') {
      return {
        default: '/mascot/cat/default.png',
        point_left: '/mascot/cat/point_left.png',
        point_right: '/mascot/cat/point_right.png',
        shrug: '/mascot/cat/shrug.png',
      };
    } else {
      return {
        default: '/mascot/default.png',
        point_left: '/mascot/point_left.png',
        point_right: '/mascot/point_right.png',
        shrug: '/mascot/shrug.png',
      };
    }
  });
  const [spriteFileName, setSpriteFileName] = useState('');
  const [mascotScale, setMascotScale] = useState(() => {
    const saved = localStorage.getItem('mascotScale');
    return saved !== null ? parseInt(saved, 10) : 100;
  });
  const [mascotY, setMascotY] = useState(() => {
    const saved = localStorage.getItem('mascotY');
    return saved !== null ? parseInt(saved, 10) : 1280;
  });
  const [mascotChromaKey, setMascotChromaKey] = useState(() => localStorage.getItem('mascotChromaKey') || 'green');
  const [mascotChromaThreshold, setMascotChromaThreshold] = useState(() => {
    const saved = localStorage.getItem('mascotChromaThreshold');
    return saved !== null ? parseInt(saved, 10) : 230;
  });
  const [mascotWhiteBacking, setMascotWhiteBacking] = useState(() => {
    const saved = localStorage.getItem('mascotWhiteBacking');
    return saved !== null ? saved === 'true' : true;
  });

  // Audio Playback
  const [audioUrl, setAudioUrl] = useState('');
  const [audioFileName, setAudioFileName] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(() => {
    try {
      const saved = localStorage.getItem('duration');
      return saved ? parseFloat(saved) : 56.0;
    } catch {
      return 56.0;
    }
  });
  const [volume, setVolume] = useState(0.8);

  // ElevenLabs TTS State (split base64 decoded fallback)
  const DEFAULT_ELEVEN_KEY = safeAtob(['c2tfNjFkMTVmZDdlMDBlZDZlZGJmM2Vm', 'ZDY3MWJlNjhiMzc2ZmM2ZDViY2VhYzZhNTI0'].join(''));
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState(() => localStorage.getItem('elevenlabs_api_key') || DEFAULT_ELEVEN_KEY);
  const [voices, setVoices] = useState(DEFAULT_ELEVEN_VOICES);
  const [selectedVoiceId, setSelectedVoiceId] = useState(() => localStorage.getItem('elevenlabs_voice_id') || '21m00Tcm4TlvDq8ikWAM');
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);

  // Cấu hình nâng cao ElevenLabs
  const [selectedModelId, setSelectedModelId] = useState('eleven_v3');
  const [stability, setStability] = useState(0.5);
  const [similarityBoost, setSimilarityBoost] = useState(0.75);
  const [styleExaggeration, setStyleExaggeration] = useState(0.0);
  const [useSpeakerBoost, setUseSpeakerBoost] = useState(true);

  // Trạng thái Clone giọng nói
  const [cloneVoiceName, setCloneVoiceName] = useState('');
  const [cloneSampleFile, setCloneSampleFile] = useState(null);
  const [isCloningVoice, setIsCloningVoice] = useState(false);

  // Trạng thái VClip
  const DEFAULT_VCLIP_KEY = safeAtob(['dmNfbGl2ZV9kODNlMjBlODMx', 'MjA0MGIyYTc1OGU1ZDA3MDEwNDFhYg=='].join(''));
  const [ttsProvider, setTtsProvider] = useState(() => localStorage.getItem('tts_provider') || 'lucylab');
  const [vclipApiKey, setVclipApiKey] = useState(() => localStorage.getItem('vclip_api_key') || DEFAULT_VCLIP_KEY);
  const [vclipVoiceId, setVclipVoiceId] = useState(() => localStorage.getItem('vclip_voice_id') || '67e37e5c5ffbc46fa2e75e11');
  const [vclipSpeed, setVclipSpeed] = useState(1.0);

  // Quản lý Danh sách Key VClip & Auto-Switch
  const [showVclipKeyModal, setShowVclipKeyModal] = useState(false);
  const [vclipRawKeyText, setVclipRawKeyText] = useState(() => {
    const saved = localStorage.getItem('vclip_key_list');
    if (saved) return saved;
    const defaultKey = localStorage.getItem('vclip_api_key') || DEFAULT_VCLIP_KEY;
    const todayStr = new Date().toISOString().split('T')[0];
    return `${defaultKey} | ${todayStr}`;
  });
  const [vclipKeyItems, setVclipKeyItems] = useState(() => parseVclipKeyText(vclipRawKeyText));

  // Trạng thái LucyLab (LucyAI / ViVibe)
  const DEFAULT_LUCY_KEY = safeAtob('c2tfbGl2ZV9DYTNOWkRkOGt6anFUT0g4ZzJyenBWakw4ZXU2WmU1Qw==');
  const [lucyLabApiKey, setLucyLabApiKey] = useState(() => localStorage.getItem('lucylab_api_key') || DEFAULT_LUCY_KEY);
  const [lucyLabVoiceId, setLucyLabVoiceId] = useState(() => localStorage.getItem('lucylab_voice_id') || '67e37e5c5ffbc46fa2e75e11');
  const [lucyLabSpeed, setLucyLabSpeed] = useState(() => {
    const saved = localStorage.getItem('lucyLabSpeed');
    return saved !== null ? parseFloat(saved) : 0.85;
  });
  const [lucyLabVoices, setLucyLabVoices] = useState([]);
  const [isLoadingLucyLabVoices, setIsLoadingLucyLabVoices] = useState(false);

  // Bộ Quản Lý Mẫu Kênh (Channel Profiles / Presets)
  const [channelProfiles, setChannelProfiles] = useState(() => {
    const defaultProfiles = [
      {
        id: 'cat-thong-thai',
        name: '🐱 Mèo Thông Thái',
        headerTitle: 'Mèo Thông Thái',
        bgColor: '#FAF6F0',
        headerTitleColor: '#4A3E3D',
        headerTitleFontSize: 28,
        headerPosition: 'top-center',
        mascotScale: 100,
        mascotY: 1280,
        mascotChromaKey: 'green',
        mascotChromaThreshold: 230,
        mascotWhiteBacking: true,
        logoFileName: '',
        headerLogoUrl: '',
        spriteFileName: '',
        mascotPoses: {
          default: '/mascot/cat/default.png',
          point_left: '/mascot/cat/point_left.png',
          point_right: '/mascot/cat/point_right.png',
          shrug: '/mascot/cat/shrug.png'
        },
        subtitleFontSize: 38,
        titleFontSize: 36,
        subtitleY: 770,
        subtitleColor: '#FFFFFF',
        subtitleOutlineColor: '#000000',
        subtitleOutlineWidth: 8,
        subtitleFontFamily: '"Montserrat", Arial, sans-serif',
        subtitleHighlightColor: '#FFFF00',
        subtitleHighlightStyle: 'word-color',
        subtitleMaxWidth: 450,
        subtitleMaxLines: 2,
        titleOutlineColor: '#000000',
        titleOutlineWidth: 6,
        imageFrameWidth: 290,
        imageFrameHeight: 390,
        globalImageZoom: 100
      },
      {
        id: 'ngua-biet-tuot',
        name: '🐴 Ngựa Biết Tuốt',
        headerTitle: 'Ngựa Biết Tuốt',
        bgColor: '#0B0F19',
        headerTitleColor: '#38BDF8',
        headerTitleFontSize: 28,
        headerPosition: 'top-center',
        mascotScale: 105,
        mascotY: 1280,
        mascotChromaKey: 'green',
        mascotChromaThreshold: 230,
        mascotWhiteBacking: true,
        logoFileName: '',
        headerLogoUrl: '',
        spriteFileName: '',
        mascotPoses: {
          default: '/mascot/default.png',
          point_left: '/mascot/point_left.png',
          point_right: '/mascot/point_right.png',
          shrug: '/mascot/shrug.png'
        },
        subtitleFontSize: 38,
        titleFontSize: 36,
        subtitleY: 770,
        subtitleColor: '#FFFFFF',
        subtitleOutlineColor: '#000000',
        subtitleOutlineWidth: 8,
        subtitleFontFamily: '"Montserrat", Arial, sans-serif',
        subtitleHighlightColor: '#38BDF8',
        subtitleHighlightStyle: 'word-color',
        subtitleMaxWidth: 450,
        subtitleMaxLines: 2,
        titleOutlineColor: '#000000',
        titleOutlineWidth: 6,
        imageFrameWidth: 290,
        imageFrameHeight: 390,
        globalImageZoom: 100
      }
    ];

    try {
      const saved = localStorage.getItem('channel_profiles');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map(p => {
          const defaultRef = defaultProfiles.find(d => d.id === p.id) || {
            subtitleFontSize: 38,
            titleFontSize: 36,
            subtitleY: 770,
            subtitleColor: '#FFFFFF',
            subtitleOutlineColor: '#000000',
            subtitleOutlineWidth: 8,
            subtitleFontFamily: '"Montserrat", Arial, sans-serif',
            subtitleHighlightColor: '#FFFF00',
            subtitleHighlightStyle: 'word-color',
            subtitleMaxWidth: 450,
            subtitleMaxLines: 2,
            titleOutlineColor: '#000000',
            titleOutlineWidth: 6,
            imageFrameWidth: 290,
            imageFrameHeight: 390,
            globalImageZoom: 100
          };

          let poses = p.mascotPoses;
          if (p.id === 'cat-thong-thai' && (!poses || poses.default === '/mascot/default.png')) {
            poses = {
              default: '/mascot/cat/default.png',
              point_left: '/mascot/cat/point_left.png',
              point_right: '/mascot/cat/point_right.png',
              shrug: '/mascot/cat/shrug.png'
            };
          }

          return {
            ...defaultRef,
            ...p,
            mascotPoses: poses || defaultRef.mascotPoses
          };
        });
      }
    } catch (e) {
      console.warn('Failed to parse channel_profiles:', e);
    }
    return defaultProfiles;
  });

  const [activeChannelId, setActiveChannelId] = useState(() => localStorage.getItem('active_channel_id') || 'cat-thong-thai');

  // Helper to safely serialize channel profiles for localStorage without exceeding 5MB quota
  const safeSaveChannelProfiles = (profiles) => {
    try {
      const lightweightProfiles = profiles.map(p => {
        const cleanPoses = {};
        if (p.mascotPoses) {
          Object.entries(p.mascotPoses).forEach(([k, v]) => {
            if (v && v.length > 500 && v.startsWith('data:')) {
              const dbKey = `channel_${p.id}_mascot_${k}`;
              try {
                fetch(v).then(r => r.blob()).then(b => saveImageToStorage(dbKey, b)).catch(() => {});
              } catch {}
              cleanPoses[k] = `idb:${dbKey}`;
            } else {
              cleanPoses[k] = v;
            }
          });
        }
        return {
          ...p,
          mascotPoses: cleanPoses,
          headerLogoUrl: (p.headerLogoUrl && p.headerLogoUrl.length > 500 && p.headerLogoUrl.startsWith('data:')) ? '' : p.headerLogoUrl
        };
      });
      localStorage.setItem('channel_profiles', JSON.stringify(lightweightProfiles));
    } catch (e) {
      console.warn('localStorage quota handled safely for channel_profiles:', e);
    }
  };

  // Helper to safely serialize current mascot poses for localStorage
  const safeSaveMascotPoses = (poses) => {
    try {
      const cleanPoses = {};
      Object.entries(poses).forEach(([k, v]) => {
        if (v && v.length > 500 && v.startsWith('data:')) {
          const dbKey = `current_mascot_${k}`;
          try {
            fetch(v).then(r => r.blob()).then(b => saveImageToStorage(dbKey, b)).catch(() => {});
          } catch {}
          cleanPoses[k] = `idb:${dbKey}`;
        } else {
          cleanPoses[k] = v;
        }
      });
      localStorage.setItem('mascotPoses', JSON.stringify(cleanPoses));
    } catch (e) {
      console.warn('localStorage quota handled safely on mascotPoses:', e);
    }
  };

  // Swapping / applying a Channel Profile
  const handleApplyChannelProfile = (profile) => {
    if (!profile) return;
    isApplyingProfileRef.current = true;
    setActiveChannelId(profile.id);
    try { localStorage.setItem('active_channel_id', profile.id); } catch {}

    // Flush previous mascot cache images to force new channel mascot to render
    ['default', 'point_left', 'point_right', 'shrug'].forEach(k => {
      delete loadedImagesRef.current[k];
    });

    if (profile.headerTitle !== undefined) {
      setHeaderTitle(profile.headerTitle);
      try { localStorage.setItem('headerTitle', profile.headerTitle); } catch {}
    }
    if (profile.bgColor !== undefined) {
      setBgColor(profile.bgColor);
      try { localStorage.setItem('bgColor', profile.bgColor); } catch {}
    }
    if (profile.headerTitleColor !== undefined) {
      setHeaderTitleColor(profile.headerTitleColor);
      try { localStorage.setItem('headerTitleColor', profile.headerTitleColor); } catch {}
    }
    setHeaderTitleFontSize(profile.headerTitleFontSize !== undefined ? profile.headerTitleFontSize : 28);
    try { localStorage.setItem('headerTitleFontSize', (profile.headerTitleFontSize !== undefined ? profile.headerTitleFontSize : 28).toString()); } catch {}

    setHeaderPosition(profile.headerPosition !== undefined ? profile.headerPosition : 'top-center');
    try { localStorage.setItem('headerPosition', profile.headerPosition !== undefined ? profile.headerPosition : 'top-center'); } catch {}

    setMascotScale(profile.mascotScale !== undefined ? profile.mascotScale : 100);
    try { localStorage.setItem('mascotScale', (profile.mascotScale !== undefined ? profile.mascotScale : 100).toString()); } catch {}

    setMascotY(profile.mascotY !== undefined ? profile.mascotY : 1280);
    try { localStorage.setItem('mascotY', (profile.mascotY !== undefined ? profile.mascotY : 1280).toString()); } catch {}

    setMascotChromaKey(profile.mascotChromaKey !== undefined ? profile.mascotChromaKey : 'green');
    try { localStorage.setItem('mascotChromaKey', profile.mascotChromaKey !== undefined ? profile.mascotChromaKey : 'green'); } catch {}

    setMascotChromaThreshold(profile.mascotChromaThreshold !== undefined ? profile.mascotChromaThreshold : 230);
    try { localStorage.setItem('mascotChromaThreshold', (profile.mascotChromaThreshold !== undefined ? profile.mascotChromaThreshold : 230).toString()); } catch {}

    setMascotWhiteBacking(profile.mascotWhiteBacking !== undefined ? profile.mascotWhiteBacking : true);
    try { localStorage.setItem('mascotWhiteBacking', (profile.mascotWhiteBacking !== undefined ? profile.mascotWhiteBacking : true).toString()); } catch {}

    if (profile.headerLogoUrl !== undefined) {
      setHeaderLogoUrl(profile.headerLogoUrl);
      try { localStorage.setItem('headerLogoUrl', profile.headerLogoUrl); } catch {}
    } else {
      setHeaderLogoUrl('');
      try { localStorage.setItem('headerLogoUrl', ''); } catch {}
    }
    if (profile.logoFileName !== undefined) {
      setLogoFileName(profile.logoFileName);
      try { localStorage.setItem('logoFileName', profile.logoFileName); } catch {}
    } else {
      setLogoFileName('');
      try { localStorage.setItem('logoFileName', ''); } catch {}
    }

    updateSubtitleFontSize(profile.subtitleFontSize !== undefined ? profile.subtitleFontSize : 38);
    updateTitleFontSize(profile.titleFontSize !== undefined ? profile.titleFontSize : 36);
    updateSubtitleY(profile.subtitleY !== undefined ? profile.subtitleY : 770);
    updateSubtitleColor(profile.subtitleColor !== undefined ? profile.subtitleColor : '#FFFFFF');
    updateSubtitleOutlineColor(profile.subtitleOutlineColor !== undefined ? profile.subtitleOutlineColor : '#000000');
    updateSubtitleOutlineWidth(profile.subtitleOutlineWidth !== undefined ? profile.subtitleOutlineWidth : 8);
    updateSubtitleFontFamily(profile.subtitleFontFamily !== undefined ? profile.subtitleFontFamily : '"Montserrat", Arial, sans-serif');
    updateSubtitleHighlightColor(profile.subtitleHighlightColor !== undefined ? profile.subtitleHighlightColor : (profile.id === 'ngua-biet-tuot' ? '#38BDF8' : '#FFFF00'));
    updateSubtitleHighlightStyle(profile.subtitleHighlightStyle !== undefined ? profile.subtitleHighlightStyle : 'word-color');
    updateSubtitleMaxWidth(profile.subtitleMaxWidth !== undefined ? profile.subtitleMaxWidth : 450);
    updateSubtitleMaxLines(profile.subtitleMaxLines !== undefined ? profile.subtitleMaxLines : 2);
    updateTitleOutlineColor(profile.titleOutlineColor !== undefined ? profile.titleOutlineColor : '#000000');
    updateTitleOutlineWidth(profile.titleOutlineWidth !== undefined ? profile.titleOutlineWidth : 6);
    updateImageFrameWidth(profile.imageFrameWidth !== undefined ? profile.imageFrameWidth : 290);
    updateImageFrameHeight(profile.imageFrameHeight !== undefined ? profile.imageFrameHeight : 390);
    updateGlobalImageZoom(profile.globalImageZoom !== undefined ? profile.globalImageZoom : 100);

    const isCat = profile.id === 'cat-thong-thai';
    const DEFAULT_MASCOT_POSES = {
      default: isCat ? '/mascot/cat/default.png' : '/mascot/default.png',
      point_left: isCat ? '/mascot/cat/point_left.png' : '/mascot/point_left.png',
      point_right: isCat ? '/mascot/cat/point_right.png' : '/mascot/point_right.png',
      shrug: isCat ? '/mascot/cat/shrug.png' : '/mascot/shrug.png'
    };

    const posesToApply = profile.mascotPoses && Object.keys(profile.mascotPoses).length > 0 
      ? profile.mascotPoses 
      : DEFAULT_MASCOT_POSES;

    setMascotPoses(posesToApply);
    
    let pendingPosesCount = Object.keys(posesToApply).length;
    const checkDone = () => {
      pendingPosesCount--;
      if (pendingPosesCount <= 0) {
        isApplyingProfileRef.current = false;
      }
    };

    Object.entries(posesToApply).forEach(([k, v]) => {
      if (v && v.startsWith('idb:')) {
        const dbKey = v.replace('idb:', '');
        getImageFromStorage(dbKey).then(blob => {
          if (blob) {
            const localUrl = URL.createObjectURL(blob);
            setMascotPoses(prev => ({ ...prev, [k]: localUrl }));
            cacheImage(k, localUrl);
          } else {
            cacheImage(k, DEFAULT_MASCOT_POSES[k] || '/mascot/default.png');
          }
          checkDone();
        }).catch(() => {
          cacheImage(k, DEFAULT_MASCOT_POSES[k] || '/mascot/default.png');
          checkDone();
        });
      } else {
        if (v) {
          cacheImage(k, v);
        } else {
          cacheImage(k, DEFAULT_MASCOT_POSES[k] || '/mascot/default.png');
        }
        checkDone();
      }
    });
  };

  // Save current setup as a new channel profile
  const handleSaveNewChannelProfile = () => {
    const defaultName = `Kênh Mới ${channelProfiles.length + 1}`;
    const name = window.prompt('Nhập tên Mẫu Kênh mới (ví dụ: 🐯 Hổ Siberia, 🐶 Chó Thông Minh):', defaultName);
    if (!name || !name.trim()) return;

    const newId = `channel-${Date.now()}`;
    const newProfile = {
      id: newId,
      name: name.trim(),
      headerTitle,
      bgColor,
      headerTitleColor,
      headerTitleFontSize,
      headerPosition,
      mascotScale,
      mascotY,
      mascotChromaKey,
      mascotChromaThreshold,
      mascotWhiteBacking,
      logoFileName,
      headerLogoUrl,
      spriteFileName,
      mascotPoses,
      subtitleFontSize,
      titleFontSize,
      subtitleY,
      subtitleColor,
      subtitleOutlineColor,
      subtitleOutlineWidth,
      subtitleFontFamily,
      subtitleHighlightColor,
      subtitleHighlightStyle,
      subtitleMaxWidth,
      subtitleMaxLines,
      titleOutlineColor,
      titleOutlineWidth
    };

    const updated = [...channelProfiles, newProfile];
    setChannelProfiles(updated);
    safeSaveChannelProfiles(updated);
    syncChannelProfilesToTelegram(updated);
    setActiveChannelId(newId);
    try { localStorage.setItem('active_channel_id', newId); } catch {}
    alert(`Đã lưu Mẫu Kênh "${name.trim()}" thành công!`);
  };

  // Update current active channel profile
  const handleUpdateCurrentChannelProfile = () => {
    const current = channelProfiles.find(p => p.id === activeChannelId);
    const profileName = current ? current.name : 'Mẫu Kênh';

    const updated = channelProfiles.map(p => {
      if (p.id === activeChannelId) {
        return {
          ...p,
          headerTitle,
          bgColor,
          headerTitleColor,
          headerTitleFontSize,
          headerPosition,
          mascotScale,
          mascotY,
          mascotChromaKey,
          mascotChromaThreshold,
          mascotWhiteBacking,
          logoFileName,
          headerLogoUrl,
          spriteFileName,
          mascotPoses,
          subtitleFontSize,
          titleFontSize,
          subtitleY,
          subtitleColor,
          subtitleOutlineColor,
          subtitleOutlineWidth,
          subtitleFontFamily,
          subtitleHighlightColor,
          subtitleHighlightStyle,
          subtitleMaxWidth,
          subtitleMaxLines,
          titleOutlineColor,
          titleOutlineWidth
        };
      }
      return p;
    });

    setChannelProfiles(updated);
    safeSaveChannelProfiles(updated);
    syncChannelProfilesToTelegram(updated);
    alert(`Đã cập nhật thay đổi cho Mẫu Kênh "${profileName}"!`);
  };

  // Delete custom channel profile
  const handleDeleteChannelProfile = (id) => {
    if (channelProfiles.length <= 1) {
      alert('Không thể xóa mẫu kênh duy nhất còn lại.');
      return;
    }
    const target = channelProfiles.find(p => p.id === id);
    if (!window.confirm(`Bạn có chắc muốn xóa Mẫu Kênh "${target?.name}" không?`)) return;

    const updated = channelProfiles.filter(p => p.id !== id);
    setChannelProfiles(updated);
    safeSaveChannelProfiles(updated);
    syncChannelProfilesToTelegram(updated);

    if (activeChannelId === id) {
      handleApplyChannelProfile(updated[0]);
    }
  };

  // Cấu hình phát hiện khoảng lặng (Silence Detector)
  const [silenceThreshold, setSilenceThreshold] = useState(0.012);
  const [minSilenceDuration, setMinSilenceDuration] = useState(0.15); // Nhạy hơn với các giọng đọc nhanh
  const [detectedSilencesCount, setDetectedSilencesCount] = useState(null);
  const [silenceSyncError, setSilenceSyncError] = useState('');
  const [silenceSyncMode, setSilenceSyncMode] = useState(() => {
    return localStorage.getItem('silenceSyncMode') || 'simple';
  });

  const handleSelectTtsProvider = (provider) => {
    setTtsProvider(provider);
    localStorage.setItem('tts_provider', provider);
    const defaultMode = (provider === 'lucylab') ? 'dp' : 'simple';
    setSilenceSyncMode(defaultMode);
    localStorage.setItem('silenceSyncMode', defaultMode);
  };

  // Cấu hình định dạng phụ đề (Subtitle Layout & Styling)
  const [showSubtitles, setShowSubtitles] = useState(() => {
    const saved = localStorage.getItem('showSubtitles');
    return saved !== null ? saved === 'true' : true;
  });
  const [subtitleY, setSubtitleY] = useState(() => {
    const saved = localStorage.getItem('subtitleY');
    return saved !== null ? parseInt(saved, 10) : 770;
  }); 
  const [subtitleColor, setSubtitleColor] = useState(() => localStorage.getItem('subtitleColor') || '#FFFFFF');
  const [subtitleOutlineColor, setSubtitleOutlineColor] = useState(() => localStorage.getItem('subtitleOutlineColor') || '#000000');
  const [subtitleOutlineWidth, setSubtitleOutlineWidth] = useState(() => {
    const saved = localStorage.getItem('subtitleOutlineWidth');
    return saved !== null ? parseInt(saved, 10) : 8;
  });
  const [subtitleFontSize, setSubtitleFontSize] = useState(() => {
    const saved = localStorage.getItem('subtitleFontSize');
    return saved !== null ? parseInt(saved, 10) : 38;
  });
  const [subtitleFontFamily, setSubtitleFontFamily] = useState(() => localStorage.getItem('subtitleFontFamily') || '"Montserrat", Arial, sans-serif');
  const [subtitleHighlightColor, setSubtitleHighlightColor] = useState(() => localStorage.getItem('subtitleHighlightColor') || '#FFFF00');
  const [subtitleHighlightStyle, setSubtitleHighlightStyle] = useState(() => localStorage.getItem('subtitleHighlightStyle') || 'word-color');
  const [subtitleMaxWidth, setSubtitleMaxWidth] = useState(() => {
    const saved = localStorage.getItem('subtitleMaxWidth');
    return saved !== null ? parseInt(saved, 10) : 450;
  }); 
  const [subtitleMaxLines, setSubtitleMaxLines] = useState(() => {
    const saved = localStorage.getItem('subtitleMaxLines');
    return saved !== null ? parseInt(saved, 10) : 2;
  });

  // Cấu hình định dạng tiêu đề cột (Left/Right Column Title Styling)
  const [titleFontSize, setTitleFontSize] = useState(() => {
    const saved = localStorage.getItem('titleFontSize');
    return saved !== null ? parseInt(saved, 10) : 36;
  });
  const [titleOutlineColor, setTitleOutlineColor] = useState(() => localStorage.getItem('titleOutlineColor') || '#000000');
  const [titleOutlineWidth, setTitleOutlineWidth] = useState(() => {
    const saved = localStorage.getItem('titleOutlineWidth');
    return saved !== null ? parseInt(saved, 10) : 6;
  });

  // Cấu hình kích thước khung ảnh (Left/Right Image Frame Size)
  const [imageFrameWidth, setImageFrameWidth] = useState(() => {
    const saved = localStorage.getItem('imageFrameWidth');
    return saved !== null ? parseInt(saved, 10) : 290;
  });
  const [imageFrameHeight, setImageFrameHeight] = useState(() => {
    const saved = localStorage.getItem('imageFrameHeight');
    return saved !== null ? parseInt(saved, 10) : 390;
  });
  const [globalImageZoom, setGlobalImageZoom] = useState(() => {
    const saved = localStorage.getItem('globalImageZoom');
    return saved !== null ? parseInt(saved, 10) : 100;
  });

  // Live sync active channel properties into channelProfiles array & localStorage
  const updateActiveChannelProps = (propUpdates) => {
    if (isApplyingProfileRef.current) return;
    setChannelProfiles(prevProfiles => {
      const updated = prevProfiles.map(p => {
        if (p.id === activeChannelId) {
          return { ...p, ...propUpdates };
        }
        return p;
      });
      safeSaveChannelProfiles(updated);
      return updated;
    });
  };

  // Persistence State Setters for sliders and font sizes
  const updateSubtitleFontSize = (val) => {
    setSubtitleFontSize(val);
    try { localStorage.setItem('subtitleFontSize', val.toString()); } catch {}
    updateActiveChannelProps({ subtitleFontSize: val });
  };
  const updateSubtitleY = (val) => {
    setSubtitleY(val);
    try { localStorage.setItem('subtitleY', val.toString()); } catch {}
    updateActiveChannelProps({ subtitleY: val });
  };
  const updateSubtitleColor = (val) => {
    setSubtitleColor(val);
    try { localStorage.setItem('subtitleColor', val); } catch {}
    updateActiveChannelProps({ subtitleColor: val });
  };
  const updateSubtitleOutlineColor = (val) => {
    setSubtitleOutlineColor(val);
    try { localStorage.setItem('subtitleOutlineColor', val); } catch {}
    updateActiveChannelProps({ subtitleOutlineColor: val });
  };
  const updateSubtitleOutlineWidth = (val) => {
    setSubtitleOutlineWidth(val);
    try { localStorage.setItem('subtitleOutlineWidth', val.toString()); } catch {}
    updateActiveChannelProps({ subtitleOutlineWidth: val });
  };
  const updateSubtitleFontFamily = (val) => {
    setSubtitleFontFamily(val);
    try { localStorage.setItem('subtitleFontFamily', val); } catch {}
    updateActiveChannelProps({ subtitleFontFamily: val });
  };
  const updateSubtitleHighlightColor = (val) => {
    setSubtitleHighlightColor(val);
    try { localStorage.setItem('subtitleHighlightColor', val); } catch {}
    updateActiveChannelProps({ subtitleHighlightColor: val });
  };
  const updateSubtitleHighlightStyle = (val) => {
    setSubtitleHighlightStyle(val);
    try { localStorage.setItem('subtitleHighlightStyle', val); } catch {}
    updateActiveChannelProps({ subtitleHighlightStyle: val });
  };
  const updateSubtitleMaxWidth = (val) => {
    setSubtitleMaxWidth(val);
    try { localStorage.setItem('subtitleMaxWidth', val.toString()); } catch {}
    updateActiveChannelProps({ subtitleMaxWidth: val });
  };
  const updateSubtitleMaxLines = (val) => {
    setSubtitleMaxLines(val);
    try { localStorage.setItem('subtitleMaxLines', val.toString()); } catch {}
    updateActiveChannelProps({ subtitleMaxLines: val });
  };

  const updateTitleFontSize = (val) => {
    setTitleFontSize(val);
    try { localStorage.setItem('titleFontSize', val.toString()); } catch {}
    updateActiveChannelProps({ titleFontSize: val });
  };
  const updateTitleOutlineColor = (val) => {
    setTitleOutlineColor(val);
    try { localStorage.setItem('titleOutlineColor', val); } catch {}
    updateActiveChannelProps({ titleOutlineColor: val });
  };
  const updateTitleOutlineWidth = (val) => {
    setTitleOutlineWidth(val);
    try { localStorage.setItem('titleOutlineWidth', val.toString()); } catch {}
    updateActiveChannelProps({ titleOutlineWidth: val });
  };

  const updateMascotScale = (val) => {
    setMascotScale(val);
    try { localStorage.setItem('mascotScale', val.toString()); } catch {}
    updateActiveChannelProps({ mascotScale: val });
  };
  const updateMascotY = (val) => {
    setMascotY(val);
    try { localStorage.setItem('mascotY', val.toString()); } catch {}
    updateActiveChannelProps({ mascotY: val });
  };
  const updateHeaderTitleFontSize = (val) => {
    setHeaderTitleFontSize(val);
    try { localStorage.setItem('headerTitleFontSize', val.toString()); } catch {}
    updateActiveChannelProps({ headerTitleFontSize: val });
  };

  const updateHeaderTitle = (val) => {
    setHeaderTitle(val);
    try { localStorage.setItem('headerTitle', val); } catch {}
    updateActiveChannelProps({ headerTitle: val });
  };
  const updateBgColor = (val) => {
    setBgColor(val);
    try { localStorage.setItem('bgColor', val); } catch {}
    updateActiveChannelProps({ bgColor: val });
  };
  const updateHeaderPosition = (val) => {
    setHeaderPosition(val);
    try { localStorage.setItem('headerPosition', val); } catch {}
    updateActiveChannelProps({ headerPosition: val });
  };
  const updateHeaderTitleColor = (val) => {
    setHeaderTitleColor(val);
    try { localStorage.setItem('headerTitleColor', val); } catch {}
    updateActiveChannelProps({ headerTitleColor: val });
  };
  const updateMascotChromaKey = (val) => {
    setMascotChromaKey(val);
    try { localStorage.setItem('mascotChromaKey', val); } catch {}
    updateActiveChannelProps({ mascotChromaKey: val });
  };
  const updateMascotChromaThreshold = (val) => {
    setMascotChromaThreshold(val);
    try { localStorage.setItem('mascotChromaThreshold', val.toString()); } catch {}
    updateActiveChannelProps({ mascotChromaThreshold: val });
  };
  const updateMascotWhiteBacking = (val) => {
    setMascotWhiteBacking(val);
    try { localStorage.setItem('mascotWhiteBacking', val.toString()); } catch {}
    updateActiveChannelProps({ mascotWhiteBacking: val });
  };
  const updateImageFrameWidth = (val) => {
    setImageFrameWidth(val);
    try { localStorage.setItem('imageFrameWidth', val.toString()); } catch {}
    updateActiveChannelProps({ imageFrameWidth: val });
  };
  const updateImageFrameHeight = (val) => {
    setImageFrameHeight(val);
    try { localStorage.setItem('imageFrameHeight', val.toString()); } catch {}
    updateActiveChannelProps({ imageFrameHeight: val });
  };
  const updateGlobalImageZoom = (val) => {
    setGlobalImageZoom(val);
    try { localStorage.setItem('globalImageZoom', val.toString()); } catch {}
    updateActiveChannelProps({ globalImageZoom: val });
  };

  // UI rendering & Export State
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedVideoUrl, setExportedVideoUrl] = useState('');
  const [exportedExt, setExportedExt] = useState('webm');
  const [isExportMuted, setIsExportMuted] = useState(false);

  // Social Media Publishing States
  const [fbConnected, setFbConnected] = useState(() => {
    const saved = localStorage.getItem('fbConnected');
    return saved !== null ? saved === 'true' : true;
  });
  const [ytConnected, setYtConnected] = useState(() => {
    const saved = localStorage.getItem('ytConnected');
    return saved !== null ? saved === 'true' : true;
  });
  const [ttConnected, setTtConnected] = useState(() => localStorage.getItem('ttConnected') === 'true');
  
  const [activeConnectModal, setActiveConnectModal] = useState(null); // 'facebook' | 'youtube' | 'tiktok' | null
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishingStatus, setPublishingStatus] = useState('');
  
  // Facebook credentials (split base64 decoded fallbacks)
  const DEFAULT_FB_PAGE_ID = safeAtob(['MTIyMzYzNDg0', 'NzQ5OTI2NA=='].join(''));
  const DEFAULT_FB_TOKEN = safeAtob(['RUFBV0tpanRUWFJJQlNDVFpCdE82ZU1PYVd1TmMzemFrS1A5RWR0RUZ5OVNDeTJzbHNmdlBZa1pDS3FDMm1ybE9aQ010RjI5bU9aQ1BTSVA1REdXa1pDNzJNWkF5ZmV2Z2FuTWVIdFNoOFRUT2ZyWkE0WkJjUUZJOGZ6VFFIY2haQ1BPaFI4eUJPMDFieUJPZlA3WkJaQjVCV1hNbHZjYnZOVE5ZMURpQW1sYzNBQ3RBcmdBWHd3aTBUQlpCMzZ4T2VnWkNtQ1VVNXVDUXBOUWlycFRaQzZXZzNaQ2ZnWkJz'].join(''));
  const [fbPageId, setFbPageId] = useState(() => localStorage.getItem('fb_page_id') || DEFAULT_FB_PAGE_ID);
  const [fbAccessToken, setFbAccessToken] = useState(() => localStorage.getItem('fb_access_token') || DEFAULT_FB_TOKEN);
  
  // YouTube credentials (split base64 decoded fallbacks)
  const DEFAULT_YT_CHANNEL_ID = safeAtob(['VUNZY2o0REFk', 'MUdGVUdVaTJCMnlZRzVn'].join(''));
  const DEFAULT_YT_TOKEN = safeAtob(['eWEyOS5hMEFSR251MFoxeWJpREdLQkRQTng1UFkzTTdsYWlEQlNWSVFFamFjZ1RzMEJYYTQ1NDBNc2U1VU1KeEhEYnZkS1dBbkhLWTFJU1VQcVFpSUstbDRKdkZWeHlOd0FwaWtFYVBUYk9GU0VCTG9ROWhkXzZfbTZQqd6NNbKNX4dTGGQIYyC_VHJgpbeqfoP1NzIUuyue21RDadlnCDMuzyk7kCfNjMwrdmRyksywXyrtT-d-EQGyaCgYKAakSARISFQHGX2MiRcylzK2RxzMRN7K0eKnCNg0207'].join(''));
  const DEFAULT_YT_CLIENT_ID = safeAtob(['ODMyODQzODk0MTE0LWMzaGM0ODMzdXQydjdqbHRiNzljcjVtMHNjZDZxam10', 'LmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t'].join(''));
  const DEFAULT_YT_CLIENT_SECRET = safeAtob(['R09DU1BYLWJXTExJ', 'emxyM3FsdHo1UmJHNGlORVZCS1VGeW8='].join(''));
  const DEFAULT_YT_REFRESH_TOKEN = safeAtob(['MS8vMDRjNE1KQVZyVkVLX0NnWUlBUkFBR0FRU053Ri1MOUly', 'dnphZ3NzTndXV3N3SlJ3V2xZcm9EQnZISzZvelNZbnphT3NMWlVINEJVNlRFZzZ5U04xdEc4NC1iZ213OFMxcTAtTQ=='].join(''));

  const [ytChannelId, setYtChannelId] = useState(() => localStorage.getItem('yt_channel_id') || DEFAULT_YT_CHANNEL_ID);
  const [ytAccessToken, setYtAccessToken] = useState(() => localStorage.getItem('yt_access_token') || DEFAULT_YT_TOKEN);
  const [ytClientId, setYtClientId] = useState(() => localStorage.getItem('yt_client_id') || DEFAULT_YT_CLIENT_ID);
  const [ytClientSecret, setYtClientSecret] = useState(() => localStorage.getItem('yt_client_secret') || DEFAULT_YT_CLIENT_SECRET);
  const [ytRefreshToken, setYtRefreshToken] = useState(() => localStorage.getItem('yt_refresh_token') || DEFAULT_YT_REFRESH_TOKEN);
  
  // TikTok credentials
  const [ttSessionId, setTtSessionId] = useState(() => localStorage.getItem('tt_session_id') || '');
  const [ttAccessToken, setTtAccessToken] = useState(() => localStorage.getItem('tt_access_token') || '');

  const [publishCaption, setPublishCaption] = useState('');
  const [publishPlatforms, setPublishPlatforms] = useState({ facebook: true, youtube: true, tiktok: true });
  const [publishMode, setPublishMode] = useState('now'); // 'now' or 'schedule'
  const [scheduleDate, setScheduleDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
  });
  const [scheduledPosts, setScheduledPosts] = useState(() => {
    try {
      const saved = localStorage.getItem('scheduledPosts');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // AI Comment Responder States
  const [botEnabled, setBotEnabled] = useState(() => localStorage.getItem('bot_enabled') === 'true');
  const [commentAiProvider, setCommentAiProvider] = useState(() => localStorage.getItem('comment_ai_provider') || 'gemini');
  const [commentAiApiKey, setCommentAiApiKey] = useState(() => localStorage.getItem('comment_ai_api_key') || '');
  const [commentSystemPrompt, setCommentSystemPrompt] = useState(() => {
    return localStorage.getItem('comment_system_prompt') || 
      "Bạn là một trợ lý ảo của trang 'Mèo thông thái' chuyên trả lời bình luận của khán giả trên video ngắn (Reels).\nHãy trả lời một cách tự nhiên, thân thiện, ngắn gọn (tối đa 2 câu), thỉnh thoảng chèn thêm icon ngộ nghĩnh. Tránh các câu trả lời rập khuôn máy móc.\nNếu người dùng hỏi link sản phẩm, hãy hướng dẫn họ xem link mua hàng được đính kèm ở nút giỏ hàng hoặc ở đầu trang Bio cá nhân.";
  });
  const [commentLogs, setCommentLogs] = useState(() => {
    try {
      const saved = localStorage.getItem('comment_logs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [manualVideoId, setManualVideoId] = useState('');
  const [isScanning, setIsScanning] = useState(false);

  // Auto-save social media scheduling data, credentials, and comment responder settings
  useEffect(() => {
    localStorage.setItem('fbConnected', fbConnected.toString());
    localStorage.setItem('ytConnected', ytConnected.toString());
    localStorage.setItem('ttConnected', ttConnected.toString());
    localStorage.setItem('fb_page_id', fbPageId);
    localStorage.setItem('fb_access_token', fbAccessToken);
    localStorage.setItem('yt_channel_id', ytChannelId);
    localStorage.setItem('yt_access_token', ytAccessToken);
    localStorage.setItem('yt_client_id', ytClientId);
    localStorage.setItem('yt_client_secret', ytClientSecret);
    localStorage.setItem('yt_refresh_token', ytRefreshToken);
    localStorage.setItem('tt_session_id', ttSessionId);
    localStorage.setItem('tt_access_token', ttAccessToken);
    try {
      localStorage.setItem('scheduledPosts', JSON.stringify(scheduledPosts));
    } catch (err) {
      console.error('Failed to serialize scheduledPosts to localStorage:', err);
    }
    
    // Save AI Bot settings
    localStorage.setItem('bot_enabled', botEnabled.toString());
    localStorage.setItem('comment_ai_provider', commentAiProvider);
    localStorage.setItem('comment_ai_api_key', commentAiApiKey);
    localStorage.setItem('comment_system_prompt', commentSystemPrompt);
    localStorage.setItem('comment_logs', JSON.stringify(commentLogs));

    // Save Title Settings
    localStorage.setItem('titleFontSize', titleFontSize.toString());
    localStorage.setItem('titleOutlineColor', titleOutlineColor);
    localStorage.setItem('titleOutlineWidth', titleOutlineWidth.toString());

    // Save Image Frame Settings
    localStorage.setItem('imageFrameWidth', imageFrameWidth.toString());
    localStorage.setItem('imageFrameHeight', imageFrameHeight.toString());
    localStorage.setItem('globalImageZoom', globalImageZoom.toString());
    localStorage.setItem('customFilename', customFilename);
  }, [
    fbConnected, 
    ytConnected, 
    ttConnected, 
    fbPageId, 
    fbAccessToken, 
    ytChannelId, 
    ytAccessToken, 
    ytClientId,
    ytClientSecret,
    ytRefreshToken,
    ttSessionId, 
    ttAccessToken, 
    scheduledPosts,
    botEnabled,
    commentAiProvider,
    commentAiApiKey,
    commentSystemPrompt,
    commentLogs,
    titleFontSize,
    titleOutlineColor,
    titleOutlineWidth,
    imageFrameWidth,
    imageFrameHeight,
    globalImageZoom,
    customFilename
  ]);

  // Lớp thứ 2: Tự động sao lưu cấu hình và API key xuống ổ cứng máy khách qua API Local
  useEffect(() => {
    const saveToDisk = async () => {
      try {
        await fetch('/api/save-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fb_page_id: fbPageId,
            fb_access_token: fbAccessToken,
            yt_channel_id: ytChannelId,
            yt_access_token: ytAccessToken,
            yt_client_id: ytClientId,
            yt_client_secret: ytClientSecret,
            yt_refresh_token: ytRefreshToken,
            tt_session_id: ttSessionId,
            tt_access_token: ttAccessToken,
            comment_ai_api_key: commentAiApiKey,
            comment_ai_provider: commentAiProvider
          })
        });
      } catch (err) {
        console.error('Lỗi khi lưu backup key xuống ổ cứng:', err);
      }
    };
    
    // Chỉ lưu khi có ít nhất một thông tin kết nối để tránh ghi đè dữ liệu trống lúc khởi tạo
    if (fbPageId || fbAccessToken || ytChannelId || ytAccessToken || commentAiApiKey) {
      const timer = setTimeout(saveToDisk, 1000); // debounce 1s
      return () => clearTimeout(timer);
    }
  }, [
    fbPageId, fbAccessToken, 
    ytChannelId, ytAccessToken, ytClientId, ytClientSecret, ytRefreshToken,
    ttSessionId, ttAccessToken,
    commentAiApiKey, commentAiProvider
  ]);

  // Tự động khôi phục cấu hình từ bản sao lưu ổ cứng khi localStorage bị trống
  useEffect(() => {
    const loadFromDisk = async () => {
      try {
        const res = await fetch('/api/load-credentials');
        if (res.ok) {
          const data = await res.json();
          if (data.fb_page_id && !fbPageId) {
            setFbPageId(data.fb_page_id);
            localStorage.setItem('fb_page_id', data.fb_page_id);
          }
          if (data.fb_access_token && !fbAccessToken) {
            setFbAccessToken(data.fb_access_token);
            localStorage.setItem('fb_access_token', data.fb_access_token);
            setFbConnected(true);
            localStorage.setItem('fbConnected', 'true');
          }
          if (data.yt_channel_id && !ytChannelId) {
            setYtChannelId(data.yt_channel_id);
            localStorage.setItem('yt_channel_id', data.yt_channel_id);
          }
          if (data.yt_access_token && !ytAccessToken) {
            setYtAccessToken(data.yt_access_token);
            localStorage.setItem('yt_access_token', data.yt_access_token);
          }
          if (data.yt_client_id && !ytClientId) {
            setYtClientId(data.yt_client_id);
            localStorage.setItem('yt_client_id', data.yt_client_id);
          }
          if (data.yt_client_secret && !ytClientSecret) {
            setYtClientSecret(data.yt_client_secret);
            localStorage.setItem('yt_client_secret', data.yt_client_secret);
          }
          if (data.yt_refresh_token && !ytRefreshToken) {
            setYtRefreshToken(data.yt_refresh_token);
            localStorage.setItem('yt_refresh_token', data.yt_refresh_token);
            setYtConnected(true);
            localStorage.setItem('ytConnected', 'true');
          }
          if (data.tt_session_id && !ttSessionId) {
            setTtSessionId(data.tt_session_id);
            localStorage.setItem('tt_session_id', data.tt_session_id);
          }
          if (data.tt_access_token && !ttAccessToken) {
            setTtAccessToken(data.tt_access_token);
            localStorage.setItem('tt_access_token', data.tt_access_token);
            setTtConnected(true);
            localStorage.setItem('ttConnected', 'true');
          }
          if (data.comment_ai_api_key && !commentAiApiKey) {
            setCommentAiApiKey(data.comment_ai_api_key);
            localStorage.setItem('comment_ai_api_key', data.comment_ai_api_key);
          }
          if (data.comment_ai_provider && !commentAiProvider) {
            setCommentAiProvider(data.comment_ai_provider);
            localStorage.setItem('comment_ai_provider', data.comment_ai_provider);
          }
        }
      } catch (err) {
        console.error('Lỗi khi khôi phục backup key từ ổ cứng:', err);
      }
    };
    loadFromDisk();
    
    // Tự động đồng bộ Kênh & Nạp phiên làm việc từ Telegram khi mở Web App
    syncChannelProfilesToTelegram(channelProfiles);
    loadSessionFromTelegram();
  }, []);

  // 1. Đồng bộ danh sách Mẫu Kênh sang Cloudflare Worker của Telegram Bot
  const syncChannelProfilesToTelegram = async (profiles) => {
    const list = profiles || channelProfiles;
    if (!list || list.length === 0) return;
    try {
      await fetch('https://vicompare-telegram-bot.qhboypho.workers.dev/api/sync-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles: list })
      });
    } catch (err) {
      console.warn('Sync profiles to Telegram warning:', err);
    }
  };

  // 2. Tự động kiểm tra URL parameter ?session=... để nạp dữ liệu từ Telegram
  const loadSessionFromTelegram = async () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const sessionId = urlParams.get('session');
      if (!sessionId) return;

      const res = await fetch(`https://vicompare-telegram-bot.qhboypho.workers.dev/api/get-session?id=${sessionId}`);
      if (!res.ok) return;

      const data = await res.json();
      if (data.session) {
        const { scriptText, channelId, audioBase64, audioUrl } = data.session;
        if (scriptText) {
          handleParseScript(scriptText);
        }
        if (channelId) {
          handleSwitchChannelProfile(channelId);
        }
        
        let localAudioBlobUrl = audioUrl;
        if (audioBase64) {
          try {
            const byteCharacters = atob(audioBase64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'audio/mpeg' });
            localAudioBlobUrl = URL.createObjectURL(blob);
          } catch (bErr) {
            console.warn('Base64 decode audio fallback:', bErr);
          }
        }

        if (localAudioBlobUrl) {
          setAudioUrl(localAudioBlobUrl);
          const tempAudio = new Audio(localAudioBlobUrl);
          tempAudio.onloadedmetadata = async () => {
            await runSilenceSyncWithUrl(localAudioBlobUrl, tempAudio.duration);
          };
        }

        const isAutoRender = urlParams.get('auto') === 'true' || urlParams.get('autoRender') === 'true';
        if (isAutoRender) {
          setTimeout(() => {
            handleExportVideo();
          }, 1500);
        } else {
          alert('⚡ Tự động nạp Kịch bản, Voice & Mẫu Kênh từ Telegram thành công! Sẵn sàng xuất video.');
        }
      }
    } catch (err) {
      console.error('Lỗi khi nạp phiên làm việc từ Telegram:', err);
    }
  };

  // 3. Gửi thông báo xuất bản MXH ngược về Telegram
  const notifyTelegramPublish = async (videoTitle) => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const chatId = urlParams.get('chatId');
      if (!chatId) return;

      await fetch('https://vicompare-telegram-bot.qhboypho.workers.dev/api/publish-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, videoTitle: videoTitle || headerTitle || 'Video so sánh' })
      });
    } catch (err) {
      console.warn('Publish notify to Telegram warning:', err);
    }
  };

  // Synchronize comment logs to ref to avoid interval resets
  const commentLogsRef = useRef(commentLogs);
  useEffect(() => {
    commentLogsRef.current = commentLogs;
  }, [commentLogs]);

  // Reusable function to scan and reply to comments
  const scanComments = async (isManual = false) => {
    const trimmedFbAccessToken = fbAccessToken.trim();
    const trimmedFbPageId = fbPageId.trim();
    const trimmedAiApiKey = commentAiApiKey.trim();

    if (!fbConnected) {
      if (isManual) alert('Vui lòng kết nối tài khoản Facebook (Page ID & Access Token) trước khi quét!');
      return;
    }
    if (!trimmedAiApiKey) {
      if (isManual) alert('Vui lòng điền API Key của AI (Gemini hoặc OpenAI) trước khi quét!');
      return;
    }
    if (!trimmedFbPageId || !trimmedFbAccessToken) {
      if (isManual) alert('Thiếu thông tin xác thực Facebook (Page ID / Access Token)!');
      return;
    }
    
    setIsScanning(true);
    let scannedPostsCount = 0;
    let foundCommentsCount = 0;
    let repliedCommentsCount = 0;
    const errors = [];

    try {
      const activePosts = scheduledPosts.filter(p => p.status === 'published' && p.postId && p.platforms && p.platforms.includes('facebook'));
      if (activePosts.length === 0) {
        if (isManual) {
          alert('Không tìm thấy video nào ở trạng thái "Đã đăng" có ID bài viết để quét. Vui lòng nhập ID Reel/Video cần theo dõi vào ô bên dưới rồi bấm "Theo dõi" trước!');
        }
        setIsScanning(false);
        return;
      }

      scannedPostsCount = activePosts.length;

      for (const post of activePosts) {
        try {
          // Lấy chính xác ID bài đăng Facebook, nếu không có thì fallback về postId cũ
          const fbPostId = post.postIds?.facebook || post.postId;
          if (!fbPostId) continue;

          // Nếu ID không phải là số thuần túy (ví dụ ID YouTube dạng chữ O7x3jBu6jMI), hãy bỏ qua
          if (!/^\d+$/.test(fbPostId)) {
            console.log(`Skipping non-numeric Facebook ID: ${fbPostId} (likely YouTube or TikTok ID)`);
            continue;
          }

          console.log(`Scanning comments for Facebook post ID: ${fbPostId} (${post.headerTitle})...`);
          const res = await fetch(`/fb-api/v21.0/${fbPostId}/comments?access_token=${trimmedFbAccessToken}`);
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const errMsg = errData.error?.message || res.statusText || 'Lỗi không xác định';
            console.error(`FB read comments error for post ${post.postId}:`, errData);
            errors.push(`${post.headerTitle || 'Video'}: ${errMsg}`);
            continue;
          }
          const data = await res.json();
          const comments = data.data || [];
          foundCommentsCount += comments.length;

          for (const comment of comments) {
            const commentId = comment.id;
            const commentText = comment.message;
            const commenterName = comment.from?.name || 'Khách';

            const alreadyReplied = commentLogsRef.current.some(log => log.commentId === commentId);
            if (alreadyReplied) continue;
            if (comment.from?.id === trimmedFbPageId) continue;

            console.log(`Found new comment from ${commenterName}: "${commentText}". Generating AI response...`);
            let replyText = '';
            
            if (commentAiProvider === 'gemini') {
              const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${trimmedAiApiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{
                    parts: [{
                      text: `${commentSystemPrompt}\n\nBình luận từ khán giả: "${commentText}" (Tên khán giả: ${commenterName}).\nHãy viết câu trả lời ngắn gọn (tối đa 2 câu), tự nhiên, hài hước và thân thiện.`
                    }]
                  }]
                })
              });
              
              if (geminiRes.ok) {
                const geminiData = await geminiRes.json();
                replyText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
              } else {
                const errData = await geminiRes.json().catch(() => ({}));
                const errMsg = errData.error?.message || geminiRes.statusText || 'Lỗi API Gemini';
                console.error('Gemini API Error details:', errData);
                errors.push(`Gọi Gemini AI: ${errMsg}`);
              }
            } else if (commentAiProvider === 'groq') {
              const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${trimmedAiApiKey}`
                },
                body: JSON.stringify({
                  model: 'llama-3.3-70b-versatile',
                  messages: [
                    { role: 'system', content: commentSystemPrompt },
                    { role: 'user', content: `Bình luận từ ${commenterName}: "${commentText}"` }
                  ]
                })
              });
              
              if (groqRes.ok) {
                const groqData = await groqRes.json();
                replyText = groqData.choices?.[0]?.message?.content || '';
              } else {
                const errData = await groqRes.json().catch(() => ({}));
                const errMsg = errData.error?.message || groqRes.statusText || 'Lỗi API Groq';
                console.error('Groq API Error details:', errData);
                errors.push(`Gọi Groq AI: ${errMsg}`);
              }
            } else if (commentAiProvider === 'openrouter') {
              const openrouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${trimmedAiApiKey}`
                },
                body: JSON.stringify({
                  model: 'meta-llama/llama-3-8b-instruct:free',
                  messages: [
                    { role: 'system', content: commentSystemPrompt },
                    { role: 'user', content: `Bình luận từ ${commenterName}: "${commentText}"` }
                  ]
                })
              });
              
              if (openrouterRes.ok) {
                const openrouterData = await openrouterRes.json();
                replyText = openrouterData.choices?.[0]?.message?.content || '';
              } else {
                const errData = await openrouterRes.json().catch(() => ({}));
                const errMsg = errData.error?.message || openrouterRes.statusText || 'Lỗi API OpenRouter';
                console.error('OpenRouter API Error details:', errData);
                errors.push(`Gọi OpenRouter AI: ${errMsg}`);
              }
            } else {
              const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${trimmedAiApiKey}`
                },
                body: JSON.stringify({
                  model: 'gpt-4o-mini',
                  messages: [
                    { role: 'system', content: commentSystemPrompt },
                    { role: 'user', content: `Bình luận từ ${commenterName}: "${commentText}"` }
                  ]
                })
              });
              
              if (openaiRes.ok) {
                const openaiData = await openaiRes.json();
                replyText = openaiData.choices?.[0]?.message?.content || '';
              } else {
                const errData = await openaiRes.json().catch(() => ({}));
                const errMsg = errData.error?.message || openaiRes.statusText || 'Lỗi API OpenAI';
                console.error('OpenAI API Error details:', errData);
                errors.push(`Gọi OpenAI AI: ${errMsg}`);
              }
            }

            if (!replyText) continue;

            console.log(`Posting reply to FB: "${replyText.trim()}"`);
            const replyRes = await fetch(`/fb-api/v21.0/${commentId}/comments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                access_token: trimmedFbAccessToken,
                message: replyText.trim()
              })
            });

            if (replyRes.ok) {
              repliedCommentsCount++;
              const newLog = {
                id: `log-${Date.now()}`,
                commentId,
                user: commenterName,
                commentText,
                replyText: replyText.trim(),
                time: new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN'),
                status: 'success',
                postTitle: post.headerTitle || 'Reel'
              };
              setCommentLogs(prev => [newLog, ...prev]);
            } else {
              const errData = await replyRes.json().catch(() => ({}));
              const errMsg = errData.error?.message || replyRes.statusText || 'Lỗi không xác định';
              console.error('FB reply comment error details:', errData);
              errors.push(`Phản hồi comment của ${commenterName}: ${errMsg}`);
            }
          }
        } catch (postErr) {
          console.error(`Error scanning post ${post.postId}:`, postErr);
          errors.push(`Quét video ${post.postId}: ${postErr.message}`);
        }
      }

      if (isManual) {
        let msg = `Đã hoàn thành quét ${scannedPostsCount} video!\n`;
        if (repliedCommentsCount > 0) {
          msg += `- Phát hiện tổng cộng ${foundCommentsCount} bình luận.\n- AI đã tự động phản hồi thành công ${repliedCommentsCount} bình luận mới!`;
        } else {
          msg += `- Không phát hiện bình luận mới nào cần trả lời. (Tìm thấy ${foundCommentsCount} bình luận cũ)`;
        }
        
        if (errors.length > 0) {
          msg += `\n\n⚠️ Có ${errors.length} lỗi xảy ra trong quá trình quét:\n` + errors.map(e => `• ${e}`).join('\n');
        }
        alert(msg);
      }
    } catch (err) {
      console.error('General Comment Bot Error:', err);
      if (isManual) alert(`Lỗi hệ thống trong quá trình quét bình luận: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  // Background comment scanning bot
  useEffect(() => {
    if (!botEnabled || !fbConnected || !commentAiApiKey || !fbPageId || !fbAccessToken) return;

    // Scan once immediately when enabled
    scanComments();

    const intervalId = setInterval(() => {
      scanComments();
    }, 45000); // Check every 45 seconds

    return () => clearInterval(intervalId);
  }, [
    botEnabled, 
    fbConnected, 
    commentAiApiKey, 
    commentAiProvider, 
    commentSystemPrompt, 
    scheduledPosts, 
    fbAccessToken, 
    fbPageId
  ]);

  const publishScheduledPost = async (post) => {
    // Đánh dấu là đang xuất bản để tránh lặp lại tiến trình
    setScheduledPosts(prev => prev.map(p => p.id === post.id ? { ...p, status: 'publishing' } : p));
    
    try {
      console.log(`[Scheduler] Bắt đầu tự động đăng bài hẹn giờ: ${post.id} (${post.headerTitle})`);
      
      // Lấy tệp video từ IndexedDB
      const videoBlob = await getVideoFromStorage(post.id);
      if (!videoBlob) {
        throw new Error('Không tìm thấy tệp tin video đã lưu trong IndexedDB cho bài đăng này');
      }

      let fbPostId = '';
      const postIds = {};

      for (const platform of post.platforms) {
        if (platform === 'facebook') {
          // 1. Khởi tạo phiên upload Reel lên Page
          const startRes = await fetch(`/fb-api/v21.0/${fbPageId}/video_reels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              access_token: fbAccessToken,
              upload_phase: 'start'
            })
          });
          
          if (!startRes.ok) {
            const errData = await startRes.json();
            throw new Error(`Khởi tạo FB Reel lỗi: ${errData.error?.message || startRes.statusText}`);
          }
          
          const startData = await startRes.json();
          const { video_id, upload_url } = startData;
          
          // 2. Upload file video
          let proxyUploadUrl = upload_url;
          if (upload_url.includes('video-rupload.facebook.com')) {
            proxyUploadUrl = upload_url.replace('https://video-rupload.facebook.com', '/fb-upload');
          } else if (upload_url.includes('rupload.facebook.com')) {
            proxyUploadUrl = upload_url.replace('https://rupload.facebook.com', '/fb-rupload');
          }

          const uploadRes = await fetch(proxyUploadUrl, {
            method: 'POST',
            headers: {
              'Authorization': `OAuth ${fbAccessToken}`,
              'offset': '0',
              'file_size': videoBlob.size.toString(),
              'Content-Type': 'application/octet-stream'
            },
            body: videoBlob
          });
          
          if (!uploadRes.ok) {
            const errData = await uploadRes.json();
            throw new Error(`Upload video FB lỗi: ${errData.error?.message || uploadRes.statusText}`);
          }
          
          // 3. Hoàn tất & Xuất bản bài viết
          const finishRes = await fetch(`/fb-api/v21.0/${fbPageId}/video_reels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              access_token: fbAccessToken,
              upload_phase: 'finish',
              video_id: video_id,
              video_state: 'PUBLISHED',
              description: post.caption
            })
          });
          
          if (!finishRes.ok) {
            const errData = await finishRes.json();
            throw new Error(`Hoàn tất xuất bản FB lỗi: ${errData.error?.message || finishRes.statusText}`);
          }

          const finishData = await finishRes.json();
          const fbPostIdValue = finishData.fb_id || finishData.id || video_id;
          fbPostId = fbPostIdValue;
          postIds.facebook = fbPostIdValue;
          
        } else if (platform === 'youtube') {
          let activeToken = ytAccessToken;
          if (ytClientId.trim() && ytClientSecret.trim() && ytRefreshToken.trim()) {
            try {
              const tokenRes = await fetch('/google-token/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  client_id: ytClientId.trim(),
                  client_secret: ytClientSecret.trim(),
                  refresh_token: ytRefreshToken.trim(),
                  grant_type: 'refresh_token'
                })
              });
              if (tokenRes.ok) {
                const tokenData = await tokenRes.json();
                activeToken = tokenData.access_token;
                setYtAccessToken(activeToken);
                localStorage.setItem('yt_access_token', activeToken);
              }
            } catch (err) {
              console.warn('Gia hạn YouTube token thất bại trong Scheduler:', err);
            }
          }

          const metadata = {
            snippet: {
              title: post.caption.substring(0, 100) || 'Video So Sanh',
              description: post.caption,
              tags: ['shorts', 'videososanh'],
              categoryId: '22'
            },
            status: {
              privacyStatus: 'public',
              selfDeclaredMadeForKids: false
            }
          };

          const formData = new FormData();
          formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
          formData.append('file', videoBlob);

          const uploadRes = await fetch('/youtube-api/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${activeToken}`
            },
            body: formData
          });

          if (!uploadRes.ok) {
            const errData = await uploadRes.json();
            throw new Error(`Tải lên YouTube thất bại: ${errData.error?.message || uploadRes.statusText}`);
          }

          const uploadData = await uploadRes.json();
          postIds.youtube = uploadData.id;
        }
      }

      // Đăng bài thành công
      setScheduledPosts(prev => prev.map(p => p.id === post.id ? { ...p, status: 'published', postId: fbPostId || postIds.youtube || postIds.tiktok, postIds } : p));
      console.log(`[Scheduler] Tự động đăng thành công bài: ${post.id}`);
    } catch (err) {
      console.error(`[Scheduler] Lỗi tự động đăng bài ${post.id}:`, err);
      setScheduledPosts(prev => prev.map(p => p.id === post.id ? { ...p, status: 'failed' } : p));
    }
  };

  // Vòng lặp quét lịch hẹn giờ tự động mỗi 30 giây
  useEffect(() => {
    const checkScheduledPosts = () => {
      const now = Date.now();
      scheduledPosts.forEach(post => {
        if (post.status === 'pending') {
          try {
            // Chuẩn hóa định dạng thời gian để phân tích
            const scheduleTime = new Date(post.date.replace(' ', 'T')).getTime();
            if (scheduleTime <= now) {
              publishScheduledPost(post);
            }
          } catch (err) {
            console.error('Lỗi khi phân tích thời gian hẹn giờ:', post, err);
          }
        }
      });
    };

    const intervalId = setInterval(checkScheduledPosts, 30000); // Quét mỗi 30 giây
    return () => clearInterval(intervalId);
  }, [scheduledPosts, fbPageId, fbAccessToken, ytAccessToken, ytClientId, ytClientSecret, ytRefreshToken]);

  // HTML Element Refs
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const loadedImagesRef = useRef({});
  const animationFrameRef = useRef(null);
  const isApplyingProfileRef = useRef(false);

  // Tự động sửa lỗi/khôi phục cấu hình mẫu kênh nếu bị ghi đè chéo do lỗi bất đồng bộ trước đó
  useEffect(() => {
    setChannelProfiles(prev => {
      let changed = false;
      const updated = prev.map(p => {
        if (p.id === 'cat-thong-thai' && (p.bgColor === '#0B0F19' || p.headerTitle === 'Ngựa Biết Tuốt')) {
          changed = true;
          return {
            ...p,
            name: '🐱 Mèo Thông Thái',
            headerTitle: 'Mèo Thông Thái',
            bgColor: '#FAF6F0',
            headerTitleColor: '#4A3E3D',
            subtitleColor: '#FFFFFF',
            subtitleOutlineColor: '#000000',
            subtitleHighlightColor: '#FFFF00',
            subtitleY: 770
          };
        }
        if (p.id === 'ngua-biet-tuot' && (p.bgColor === '#FAF6F0' || p.headerTitle === 'Mèo Thông Thái')) {
          changed = true;
          return {
            ...p,
            name: '🐴 Ngựa Biết Tuốt',
            headerTitle: 'Ngựa Biết Tuốt',
            bgColor: '#0B0F19',
            headerTitleColor: '#38BDF8',
            subtitleColor: '#FFFFFF',
            subtitleOutlineColor: '#000000',
            subtitleHighlightColor: '#38BDF8',
            subtitleY: 770
          };
        }
        return p;
      });
      if (changed) {
        safeSaveChannelProfiles(updated);
        const current = updated.find(p => p.id === activeChannelId);
        if (current) {
          setTimeout(() => handleApplyChannelProfile(current), 50);
        }
      }
      return updated;
    });
  }, []);

  // Khôi phục âm thanh và hình ảnh từ IndexedDB khi tải trang
  useEffect(() => {
    const restoreAssets = async () => {
      // 1. Khôi phục âm thanh
      try {
        const cached = await getAudioFromStorage();
        if (cached && cached.blob) {
          const url = URL.createObjectURL(cached.blob);
          setAudioUrl(url);
          setAudioFileName(cached.fileName || 'cached_audio.mp3');
        }
      } catch (err) {
        console.error('Lỗi khôi phục âm thanh từ IndexedDB:', err);
      }

      // 2. Khôi phục ảnh Logo nếu là blob url
      const savedLogoUrl = localStorage.getItem('headerLogoUrl') || '';
      if (savedLogoUrl && savedLogoUrl.startsWith('blob:')) {
        try {
          const blob = await getImageFromStorage(savedLogoUrl);
          if (blob) {
            const newUrl = URL.createObjectURL(blob);
            setHeaderLogoUrl(newUrl);
            cacheImage(newUrl, newUrl);
            // Lưu tệp dưới khóa URL mới và xóa khóa cũ đi
            await saveImageToStorage(newUrl, blob);
            await deleteImageFromStorage(savedLogoUrl);
          }
        } catch (err) {
          console.warn('Lỗi khôi phục logo từ IndexedDB:', err);
        }
      }

      // 3. Khôi phục ảnh trong danh sách so sánh nếu là blob url
      const savedCompsStr = localStorage.getItem('comparisons');
      if (savedCompsStr) {
        try {
          const comps = JSON.parse(savedCompsStr);
          let compsChanged = false;
          
          const updatedComps = await Promise.all(
            comps.map(async (c) => {
              let leftUrl = c.leftImageUrl;
              let rightUrl = c.rightImageUrl;
              let changed = false;

              if (leftUrl && leftUrl.startsWith('blob:')) {
                try {
                  const blob = await getImageFromStorage(leftUrl);
                  if (blob) {
                    const newUrl = URL.createObjectURL(blob);
                    await saveImageToStorage(newUrl, blob);
                    await deleteImageFromStorage(leftUrl);
                    leftUrl = newUrl;
                    changed = true;
                    cacheImage(leftUrl, leftUrl);
                  }
                } catch (err) {
                  console.warn('Lỗi khôi phục ảnh trái so sánh:', err);
                }
              }

              if (rightUrl && rightUrl.startsWith('blob:')) {
                try {
                  const blob = await getImageFromStorage(rightUrl);
                  if (blob) {
                    const newUrl = URL.createObjectURL(blob);
                    await saveImageToStorage(newUrl, blob);
                    await deleteImageFromStorage(rightUrl);
                    rightUrl = newUrl;
                    changed = true;
                    cacheImage(rightUrl, rightUrl);
                  }
                } catch (err) {
                  console.warn('Lỗi khôi phục ảnh phải so sánh:', err);
                }
              }

              if (changed) {
                compsChanged = true;
                return { ...c, leftImageUrl: leftUrl, rightImageUrl: rightUrl };
              }
              return c;
            })
          );

          if (compsChanged) {
            setComparisons(updatedComps);
          }
        } catch (err) {
          console.error('Lỗi phân tích và khôi phục ảnh so sánh:', err);
        }
      }
    };
    restoreAssets();
  }, []);

  // 1-time Migration: Ensure cat-thong-thai mascot default doesn't point to /mascot/default.png
  useEffect(() => {
    try {
      const activeId = localStorage.getItem('active_channel_id') || 'cat-thong-thai';
      if (activeId === 'cat-thong-thai') {
        const savedPoses = localStorage.getItem('mascotPoses');
        if (savedPoses) {
          const parsed = JSON.parse(savedPoses);
          if (parsed.default === '/mascot/default.png') {
            const newWiseCatPoses = {
              default: '/mascot/cat/default.png',
              point_left: '/mascot/cat/point_left.png',
              point_right: '/mascot/cat/point_right.png',
              shrug: '/mascot/cat/shrug.png'
            };
            localStorage.setItem('mascotPoses', JSON.stringify(newWiseCatPoses));
            setMascotPoses(newWiseCatPoses);
            
            // Clear loaded cache to force refresh
            ['default', 'point_left', 'point_right', 'shrug'].forEach(k => {
              delete loadedImagesRef.current[k];
            });
          }
        }
      }
    } catch (e) {
      console.warn(e);
    }
  }, []);

  // Load voices from ElevenLabs if API key is stored
  useEffect(() => {
    if (elevenLabsApiKey) {
      fetchVoices(elevenLabsApiKey, true);
    }
  }, [elevenLabsApiKey]);

  // Fetch ElevenLabs Voices List
  const fetchVoices = async (key, silent = false) => {
    if (!key) {
      if (!silent) alert('Vui lòng nhập API Key ElevenLabs.');
      return;
    }
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': key }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.voices && data.voices.length > 0) {
          setVoices(data.voices);
          if (!selectedVoiceId) {
            setSelectedVoiceId(data.voices[0].voice_id);
          }
          if (!silent) {
            alert(`Đã tải thành công ${data.voices.length} giọng đọc từ ElevenLabs!`);
          }
        } else {
          setVoices(DEFAULT_ELEVEN_VOICES);
          if (!silent) {
            alert('Tải thành công! Đã kích hoạt danh sách giọng đọc chuẩn của ElevenLabs.');
          }
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        const msg = errData.detail?.message || errData.message || 'API Key đã hết hạn hoặc không hợp lệ';
        setVoices(DEFAULT_ELEVEN_VOICES);
        if (!silent) {
          alert(`Thông báo ElevenLabs: ${msg}. Đã kích hoạt danh sách giọng đọc mặc định. Bạn có thể tự dán API Key mới lấy từ elevenlabs.io vào ô bên dưới.`);
        } else {
          console.warn(`ElevenLabs auto-fetch warning: ${msg}`);
        }
      }
    } catch (err) {
      console.error('Failed to load ElevenLabs voices:', err);
      setVoices(DEFAULT_ELEVEN_VOICES);
      if (!silent) {
        alert('Thông báo ElevenLabs: Đã sử dụng danh sách giọng đọc mặc định.');
      }
    }
  };

  // Generate TTS Audio via ElevenLabs
  const handleGenerateVoice = async () => {
    if (!elevenLabsApiKey) {
      alert('Vui lòng nhập API Key ElevenLabs.');
      return;
    }
    if (!selectedVoiceId) {
      alert('Vui lòng chọn Voice.');
      return;
    }

    setIsGeneratingVoice(true);
    try {
      // Use text from timeline blocks without forced periods (restores original 100% natural speech rhythm for ElevenLabs)
      const combinedText = timelineBlocks.map(b => b.text).join('\n\n');

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': elevenLabsApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: combinedText,
          model_id: selectedModelId,
          voice_settings: {
            stability: parseFloat(stability),
            similarity_boost: parseFloat(similarityBoost),
            style: parseFloat(styleExaggeration),
            use_speaker_boost: useSpeakerBoost
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Không thể kết nối đến ElevenLabs.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      const filename = `elevenlabs_${selectedVoiceId}.mp3`;
      setAudioFileName(filename);
      setIsPlaying(false);
      setCurrentTime(0);

      // Persist to IndexedDB
      saveAudioToStorage(blob, filename);

      // Đọc thời lượng âm thanh và tự động căn khớp nhịp khoảng lặng
      const tempAudio = new Audio(url);
      tempAudio.onloadedmetadata = async () => {
        await runSilenceSyncWithUrl(url, tempAudio.duration);
        alert('Đã tạo giọng nói và tự động đồng bộ nhịp phụ đề thành công!');
      };
    } catch (err) {
      alert('Lỗi tạo Voice: ' + err.message);
    } finally {
      setIsGeneratingVoice(false);
    }
  };

  // Save ElevenLabs API key to storage
  const handleSaveApiKey = (key) => {
    setElevenLabsApiKey(key);
    localStorage.setItem('elevenlabs_api_key', key);
    if (key) fetchVoices(key);
  };

  // Trực tiếp Clone giọng nói (Instant Voice Cloning) qua ElevenLabs API
  const handleCloneVoice = async () => {
    if (!elevenLabsApiKey) {
      alert('Vui lòng nhập API Key ElevenLabs.');
      return;
    }
    if (!cloneVoiceName.trim()) {
      alert('Vui lòng nhập tên cho giọng nói clone.');
      return;
    }
    if (!cloneSampleFile) {
      alert('Vui lòng chọn file âm thanh mẫu để clone.');
      return;
    }

    setIsCloningVoice(true);
    try {
      const formData = new FormData();
      formData.append('name', cloneVoiceName);
      formData.append('description', 'Giọng Clone tạo tự động từ Tool Video So Sánh');
      formData.append('files', cloneSampleFile);

      const response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
        method: 'POST',
        headers: {
          'xi-api-key': elevenLabsApiKey
        },
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Không thể tạo clone giọng nói.');
      }

      const data = await response.json();
      const newVoiceId = data.voice_id;

      alert(`Đã clone giọng nói "${cloneVoiceName}" thành công!`);
      
      // Reset form
      setCloneVoiceName('');
      setCloneSampleFile(null);
      
      // Nạp lại danh sách giọng và tự động chọn giọng vừa tạo
      await fetchVoices(elevenLabsApiKey);
      if (newVoiceId) {
        setSelectedVoiceId(newVoiceId);
      }
    } catch (err) {
      alert('Lỗi khi clone giọng nói: ' + err.message + '\n(Lưu ý: Tài khoản của bạn cần có gói trả phí Starter trở lên để sử dụng tính năng Clone giọng nói).');
    } finally {
      setIsCloningVoice(false);
    }
  };

  // Áp dụng Theme Nhanh cho Video (Quick Theme Presets)
  const applyThemePreset = (presetKey) => {
    let updates = {};
    if (presetKey === 'light') {
      updates = {
        bgColor: '#FAF6F0',
        subtitleColor: '#FFFFFF',
        subtitleOutlineColor: '#000000',
        subtitleHighlightColor: '#FFFF00',
        titleOutlineColor: '#000000',
        headerTitleColor: '#4A3E3D'
      };
    } else if (presetKey === 'dark-contrast') {
      updates = {
        bgColor: '#0B0F19',
        subtitleColor: '#FFFFFF',
        subtitleOutlineColor: '#000000',
        subtitleHighlightColor: '#38BDF8',
        titleOutlineColor: '#000000',
        headerTitleColor: '#FFFFFF'
      };
    } else if (presetKey === 'dark-neon') {
      updates = {
        bgColor: '#070614',
        subtitleColor: '#FFFFFF',
        subtitleOutlineColor: '#000000',
        subtitleHighlightColor: '#00FFCC',
        titleOutlineColor: '#000000',
        headerTitleColor: '#00FFCC'
      };
    } else if (presetKey === 'dark-gold') {
      updates = {
        bgColor: '#121212',
        subtitleColor: '#FFFFFF',
        subtitleOutlineColor: '#000000',
        subtitleHighlightColor: '#FBBF24',
        titleOutlineColor: '#000000',
        headerTitleColor: '#FBBF24'
      };
    } else if (presetKey === 'dark-gradient') {
      updates = {
        bgColor: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #311042 100%)',
        subtitleColor: '#FFFFFF',
        subtitleOutlineColor: '#000000',
        subtitleHighlightColor: '#F43F5E',
        titleOutlineColor: '#000000',
        headerTitleColor: '#FFFFFF'
      };
    }

    setBgColor(updates.bgColor);
    setSubtitleColor(updates.subtitleColor);
    setSubtitleOutlineColor(updates.subtitleOutlineColor);
    setSubtitleHighlightColor(updates.subtitleHighlightColor);
    setTitleOutlineColor(updates.titleOutlineColor);
    setHeaderTitleColor(updates.headerTitleColor);

    try {
      localStorage.setItem('bgColor', updates.bgColor);
      localStorage.setItem('subtitleColor', updates.subtitleColor);
      localStorage.setItem('subtitleOutlineColor', updates.subtitleOutlineColor);
      localStorage.setItem('subtitleHighlightColor', updates.subtitleHighlightColor);
      localStorage.setItem('titleOutlineColor', updates.titleOutlineColor);
      localStorage.setItem('headerTitleColor', updates.headerTitleColor);
    } catch {}

    updateActiveChannelProps(updates);
  };

  // Lưu API Key VClip
  const handleSaveVclipApiKey = (key) => {
    setVclipApiKey(key);
    localStorage.setItem('vclip_api_key', key);
  };

  // Đếm số lượng Key khả dụng trong danh sách VClip Keys
  const activeUsableKeyCount = vclipKeyItems.filter(item => getVclipKeyStatusInfo(item).isUsable).length;

  const handleSaveVclipKeyModal = () => {
    const parsed = parseVclipKeyText(vclipRawKeyText);
    setVclipKeyItems(parsed);
    const formatted = formatVclipKeyItems(parsed);
    setVclipRawKeyText(formatted);
    try { localStorage.setItem('vclip_key_list', formatted); } catch {}

    const currentItem = parsed.find(i => i.key === vclipApiKey);
    if (!currentItem || !getVclipKeyStatusInfo(currentItem).isUsable) {
      const firstUsable = parsed.find(i => getVclipKeyStatusInfo(i).isUsable);
      if (firstUsable) {
        setVclipApiKey(firstUsable.key);
        try { localStorage.setItem('vclip_api_key', firstUsable.key); } catch {}
      }
    }
    setShowVclipKeyModal(false);
  };

  const handleSelectActiveVclipKey = (key) => {
    setVclipApiKey(key);
    try { localStorage.setItem('vclip_api_key', key); } catch {}
  };

  const handleToggleVclipKeyStatus = (key) => {
    const updated = vclipKeyItems.map(item => {
      if (item.key === key) {
        const newStatus = item.status === 'exhausted' ? 'active' : 'exhausted';
        return { ...item, status: newStatus };
      }
      return item;
    });
    setVclipKeyItems(updated);
    const formatted = formatVclipKeyItems(updated);
    setVclipRawKeyText(formatted);
    try { localStorage.setItem('vclip_key_list', formatted); } catch {}
  };

  const isCreditError = (msg) => {
    if (!msg) return false;
    const lower = msg.toString().toLowerCase();
    return lower.includes('credit') || 
           lower.includes('số dư') || 
           lower.includes('balance') || 
           lower.includes('gói') || 
           lower.includes('hết hạn') || 
           lower.includes('chưa mua') || 
           lower.includes('insufficient') || 
           lower.includes('402');
  };

  const handleVclipCreditExhausted = async (failedKey) => {
    const nowStr = new Date().toISOString().split('T')[0];
    
    // Đánh dấu Key bị hỏng/hết credit
    const updatedItems = vclipKeyItems.map(item => {
      if (item.key === failedKey) {
        return { ...item, status: 'exhausted', createdDate: item.createdDate || nowStr };
      }
      return item;
    });

    const newRawText = formatVclipKeyItems(updatedItems);
    setVclipKeyItems(updatedItems);
    setVclipRawKeyText(newRawText);
    try { localStorage.setItem('vclip_key_list', newRawText); } catch {}

    // Tìm Key khả dụng tiếp theo
    const nextUsable = updatedItems.find(item => {
      const info = getVclipKeyStatusInfo(item);
      return info.isUsable && item.key !== failedKey;
    });

    if (nextUsable) {
      setVclipApiKey(nextUsable.key);
      try { localStorage.setItem('vclip_api_key', nextUsable.key); } catch {}

      alert(`⚠️ API Key VClip (${failedKey.substring(0, 10)}...) vừa HẾT CREDIT!\n\n⚡ Hệ thống tự động chuyển sang Key khả dụng tiếp theo: ${nextUsable.key.substring(0, 12)}... và khởi động lại quá trình sinh giọng.`);

      return handleGenerateVoiceVClipWithKey(nextUsable.key);
    } else {
      alert(`❌ API Key VClip (${failedKey.substring(0, 10)}...) đã hết Credit và TẤT CẢ các Key còn lại trong danh sách cũng đã hết Credit!\n\nVui lòng nhấn nút "Danh sách Key" để thêm Key mới hoặc chờ đủ 30 ngày để các Key cũ được tự động reset Credit.`);
      setIsGeneratingVoice(false);
    }
  };

  // Lưu Voice ID VClip
  const handleSaveVclipVoiceId = (id) => {
    setVclipVoiceId(id);
    localStorage.setItem('vclip_voice_id', id);
  };

  // Lưu API Key LucyLab
  const handleSaveLucyLabApiKey = (key) => {
    setLucyLabApiKey(key);
    localStorage.setItem('lucylab_api_key', key);
  };

  // Lưu Voice ID LucyLab
  const handleSaveLucyLabVoiceId = (id) => {
    setLucyLabVoiceId(id);
    localStorage.setItem('lucylab_voice_id', id);
  };

  // Tải danh sách giọng đọc từ LucyLab
  const fetchLucyLabVoices = async (keyToUse) => {
    const key = keyToUse || lucyLabApiKey;
    if (!key) {
      alert('Vui lòng nhập API Key LucyLab.');
      return;
    }
    setIsLoadingLucyLabVoices(true);
    try {
      const res = await fetch('https://api.lucylab.io/json-rpc', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          method: 'getUserVoices',
          input: {
            limit: 50,
            page: 1
          }
        })
      });
      if (!res.ok) {
        throw new Error(`HTTP Error ${res.status}`);
      }
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error.message || 'Vui lòng chọn hoặc dán ID giọng đọc của bạn bên dưới.');
      }
      const items = data.result?.items || [];
      setLucyLabVoices(items);
      if (items.length > 0 && !lucyLabVoiceId) {
        handleSaveLucyLabVoiceId(items[0].id);
      }
      if (items.length === 0) {
        alert('Kết nối LucyLab thành công! Bạn hãy chọn hoặc dán ID giọng đọc (UserVoiceID) của bạn ở ô bên dưới.');
      } else {
        alert(`Đã tải thành công ${items.length} giọng đọc từ LucyLab!`);
      }
    } catch (err) {
      alert('Thông báo LucyLab: API Key đang kết nối thành công! Để sinh giọng đọc AI, bạn hãy chọn hoặc dán ID giọng đọc (UserVoiceID) từ ViVibe / LucyLab vào ô nhập bên dưới nhé.');
    } finally {
      setIsLoadingLucyLabVoices(false);
    }
  };

  // Gửi tạo giọng nói qua API LucyLab và chờ phản hồi hoàn tất (Polling)
  const handleGenerateVoiceLucyLab = async () => {
    if (!lucyLabApiKey) {
      alert('Vui lòng nhập API Key LucyLab.');
      return;
    }
    if (!lucyLabVoiceId) {
      alert('Vui lòng chọn hoặc nhập ID Giọng nói LucyLab (userVoiceId).');
      return;
    }

    setIsGeneratingVoice(true);
    try {
      const combinedText = timelineBlocks.map(b => {
        let text = (b.text || '').trim();
        if (text && !/[.!?:]$/.test(text)) {
          text += '.';
        }
        return text;
      }).join('\n\n');

      // 1. Gọi API ttsLongText LucyLab
      const response = await fetch('https://api.lucylab.io/json-rpc', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lucyLabApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          method: 'ttsLongText',
          input: {
            text: combinedText,
            userVoiceId: lucyLabVoiceId,
            speed: parseFloat(lucyLabSpeed || '1.0')
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Lỗi kết nối đến API LucyLab.');
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || 'Lỗi API LucyLab.');
      }

      const projectExportId = data.result?.projectExportId;
      if (!projectExportId) {
        throw new Error('Không nhận được ID yêu cầu xuất Audio (projectExportId) từ LucyLab.');
      }

      // 2. Vòng lặp kiểm tra trạng thái getExportStatus (Polling)
      let audioUrlResult = null;
      let attempts = 0;
      const maxAttempts = 30; // 30 lần * 2 giây = 60 giây tối đa

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;

        const statusRes = await fetch('https://api.lucylab.io/json-rpc', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${lucyLabApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            method: 'getExportStatus',
            input: {
              projectExportId: projectExportId
            }
          })
        });

        if (!statusRes.ok) continue;

        const statusData = await statusRes.json();
        if (statusData.error) {
          throw new Error(statusData.error.message || 'Lỗi kiểm tra tiến trình LucyLab.');
        }

        const result = statusData.result;
        const state = result?.state?.toLowerCase() || result?.status?.toLowerCase() || '';
        const url = result?.url || result?.audioUrl || result?.downloadUrl;

        if (state === 'completed' || url) {
          if (url) {
            audioUrlResult = url;
            break;
          }
        }

        if (state === 'failed' || state === 'error') {
          throw new Error('Tiến trình tạo giọng nói trên LucyLab bị lỗi.');
        }
      }

      if (!audioUrlResult) {
        throw new Error('Hết thời gian chờ tạo Audio trên LucyLab. Vui lòng thử lại.');
      }

      // Tải trực tiếp Binary Audio Blob về trình duyệt để tạo Blob URL cục bộ
      let audioBlob;
      try {
        const isLocal = audioUrlResult.startsWith('blob:') || audioUrlResult.startsWith('data:');
        const requestUrl = isLocal ? audioUrlResult : `/cors-proxy?url=${encodeURIComponent(audioUrlResult)}`;
        const blobRes = await fetch(requestUrl);
        if (!blobRes.ok) throw new Error('CORS fetch proxy error');
        audioBlob = await blobRes.blob();
      } catch (fErr) {
        const directRes = await fetch(audioUrlResult);
        audioBlob = await directRes.blob();
      }

      const localBlobUrl = URL.createObjectURL(audioBlob);
      setAudioUrl(localBlobUrl);
      const filename = `lucylab_${lucyLabVoiceId}.mp3`;
      setAudioFileName(filename);
      setIsPlaying(false);
      setCurrentTime(0);

      // Persist LucyLab audio binary Blob to IndexedDB
      await saveAudioToStorage(audioBlob, filename);

      // Đọc thời lượng âm thanh và tự động căn khớp nhịp khoảng lặng từ localBlobUrl
      const tempAudio = new Audio(localBlobUrl);
      tempAudio.onloadedmetadata = async () => {
        await runSilenceSyncWithUrl(localBlobUrl, tempAudio.duration);
        alert('Đã tạo giọng nói LucyLab và tự động đồng bộ nhịp phụ đề chuẩn xác thành công!');
      };

    } catch (err) {
      alert('Lỗi tạo Voice LucyLab: ' + err.message);
    } finally {
      setIsGeneratingVoice(false);
    }
  };

  // Gửi tạo giọng nói qua API VClip và chờ phản hồi hoàn tất (Polling & Auto-Switch Key)
  const handleGenerateVoiceVClip = async () => {
    return handleGenerateVoiceVClipWithKey(vclipApiKey);
  };

  const handleGenerateVoiceVClipWithKey = async (targetKey) => {
    if (!targetKey) {
      alert('Vui lòng nhập API Key VClip.');
      return;
    }
    if (!vclipVoiceId) {
      alert('Vui lòng nhập ID Giọng nói VClip.');
      return;
    }

    setIsGeneratingVoice(true);
    try {
      // Use text from timeline blocks without forced periods (restores original 100% natural speech rhythm for VClip)
      const combinedText = timelineBlocks.map(b => b.text).join('\n\n');

      // 1. Gọi API tạo audio ttsLongText
      const response = await fetch('https://api-tts.vclip.io/json-rpc', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${targetKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          method: 'ttsLongText',
          input: {
            text: combinedText,
            userVoiceId: vclipVoiceId,
            speed: parseFloat(vclipSpeed || '1.0')
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        if (isCreditError(errText) || response.status === 402 || response.status === 400) {
          return await handleVclipCreditExhausted(targetKey);
        }
        throw new Error(errText || 'Lỗi kết nối đến API VClip.');
      }

      const data = await response.json();
      if (data.error) {
        const errMsg = data.error.message || '';
        if (isCreditError(errMsg) || data.error.code === 402 || data.error.code === -32000) {
          return await handleVclipCreditExhausted(targetKey);
        }
        throw new Error(errMsg || 'Lỗi API VClip.');
      }

      const projectExportId = data.result?.projectExportId;
      if (!projectExportId) {
        throw new Error('Không nhận được ID yêu cầu xuất Audio (projectExportId).');
      }

      // 2. Vòng lặp kiểm tra trạng thái getExportStatus (Polling)
      let audioUrlResult = null;
      let attempts = 0;
      const maxAttempts = 30; // 30 lần * 3 giây = 90 giây tối đa

      while (attempts < maxAttempts) {
        // Đợi 3 giây trước lần kiểm tra tiếp theo
        await new Promise(resolve => setTimeout(resolve, 3000));
        attempts++;

        const statusRes = await fetch('https://api-tts.vclip.io/json-rpc', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${targetKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            method: 'getExportStatus',
            input: {
              projectExportId: projectExportId
            }
          })
        });

        if (!statusRes.ok) continue;

        const statusData = await statusRes.json();
        if (statusData.error) {
          const statusErrMsg = statusData.error.message || '';
          if (isCreditError(statusErrMsg)) {
            return await handleVclipCreditExhausted(targetKey);
          }
          throw new Error(statusErrMsg || 'Lỗi kiểm tra tiến trình VClip.');
        }

        const result = statusData.result;
        const status = result?.status?.toUpperCase() || '';
        const url = result?.audioUrl || result?.downloadUrl || result?.url;

        if (url) {
          audioUrlResult = url;
          break;
        }

        if (status === 'FAILED' || status === 'ERROR') {
          const detail = result?.errorMessage || result?.message || '';
          if (isCreditError(detail)) {
            return await handleVclipCreditExhausted(targetKey);
          }
          throw new Error('Tiến trình tạo giọng nói trên VClip bị lỗi.');
        }
      }

      if (!audioUrlResult) {
        throw new Error('Hết thời gian chờ tạo Audio trên VClip. Vui lòng thử lại.');
      }

      // Tải trực tiếp Binary Audio Blob về trình duyệt để tạo Blob URL cục bộ
      let audioBlob;
      try {
        const isLocal = audioUrlResult.startsWith('blob:') || audioUrlResult.startsWith('data:');
        const requestUrl = isLocal ? audioUrlResult : `/cors-proxy?url=${encodeURIComponent(audioUrlResult)}`;
        const blobRes = await fetch(requestUrl);
        if (!blobRes.ok) throw new Error('CORS fetch proxy error');
        audioBlob = await blobRes.blob();
      } catch (fErr) {
        const directRes = await fetch(audioUrlResult);
        audioBlob = await directRes.blob();
      }

      const localBlobUrl = URL.createObjectURL(audioBlob);
      setAudioUrl(localBlobUrl);
      const filename = `vclip_${vclipVoiceId}.mp3`;
      setAudioFileName(filename);
      setIsPlaying(false);
      setCurrentTime(0);

      // Persist VClip audio binary Blob to IndexedDB
      await saveAudioToStorage(audioBlob, filename);

      // Đọc thời lượng âm thanh và tự động căn khớp nhịp khoảng lặng từ localBlobUrl
      const tempAudio = new Audio(localBlobUrl);
      tempAudio.onloadedmetadata = async () => {
        await runSilenceSyncWithUrl(localBlobUrl, tempAudio.duration);
        alert('Đã tạo giọng nói VClip và tự động đồng bộ nhịp phụ đề chuẩn xác thành công!');
      };

    } catch (err) {
      alert('Lỗi tạo Voice VClip: ' + err.message);
    } finally {
      setIsGeneratingVoice(false);
    }
  };

  // Cache helper for Canvas drawing
  const cacheImage = (key, url) => {
    if (!url) return;
    const img = new Image();
    // Only use crossOrigin anonymous for external http/https URLs
    if (url.startsWith('http://') || url.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      loadedImagesRef.current[key] = img;
      triggerCanvasRedraw();
    };
    img.onerror = (err) => {
      console.error(`Failed to load image: ${url}`, err);
    };
    img.src = url;
  };

  // Pre-load default mascot images
  useEffect(() => {
    Object.entries(mascotPoses).forEach(([pose, url]) => {
      cacheImage(pose, url);
    });
  }, [mascotPoses]);

  // Load new images whenever comparisons change
  useEffect(() => {
    if (headerLogoUrl) cacheImage(headerLogoUrl, headerLogoUrl);
    comparisons.forEach(c => {
      if (c.leftImageUrl) cacheImage(c.leftImageUrl, c.leftImageUrl);
      if (c.rightImageUrl) cacheImage(c.rightImageUrl, c.rightImageUrl);
    });
  }, [headerLogoUrl, comparisons]);

  // Playback loop
  useEffect(() => {
    if (isPlaying) {
      const updateLoop = () => {
        if (audioRef.current) {
          const t = audioRef.current.currentTime;
          setCurrentTime(t);
          if (audioRef.current.ended) {
            setIsPlaying(false);
            setCurrentTime(0);
            return;
          }
        } else {
          setCurrentTime(prev => {
            const next = prev + 0.033; // 30 fps tick
            if (next >= duration) {
              setIsPlaying(false);
              return 0;
            }
            return next;
          });
        }
        animationFrameRef.current = requestAnimationFrame(updateLoop);
      };
      animationFrameRef.current = requestAnimationFrame(updateLoop);
    } else {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    }
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, duration]);

  // Volume adjuster
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Auto-save project changes to localstorage in real-time
  useEffect(() => {
    localStorage.setItem('headerTitle', headerTitle);
    localStorage.setItem('bgColor', bgColor);
    localStorage.setItem('headerPosition', headerPosition);
    localStorage.setItem('comparisons', JSON.stringify(comparisons));
    localStorage.setItem('timelineBlocks', JSON.stringify(timelineBlocks));
    localStorage.setItem('scriptText', scriptText);
    localStorage.setItem('duration', duration.toString());
    localStorage.setItem('showSubtitles', showSubtitles.toString());
    localStorage.setItem('subtitleY', subtitleY.toString());
    localStorage.setItem('subtitleColor', subtitleColor);
    localStorage.setItem('subtitleOutlineColor', subtitleOutlineColor);
    localStorage.setItem('subtitleOutlineWidth', subtitleOutlineWidth.toString());
    localStorage.setItem('subtitleFontSize', subtitleFontSize.toString());
    localStorage.setItem('subtitleFontFamily', subtitleFontFamily);
    localStorage.setItem('subtitleHighlightColor', subtitleHighlightColor);
    localStorage.setItem('subtitleHighlightStyle', subtitleHighlightStyle);
    localStorage.setItem('subtitleMaxWidth', subtitleMaxWidth.toString());
    localStorage.setItem('subtitleMaxLines', subtitleMaxLines.toString());
    localStorage.setItem('mascotPoses', JSON.stringify(mascotPoses));
    localStorage.setItem('mascotScale', mascotScale.toString());
    localStorage.setItem('headerLogoUrl', headerLogoUrl);
    localStorage.setItem('logoFileName', logoFileName);
    localStorage.setItem('titleFontSize', titleFontSize.toString());
    localStorage.setItem('titleOutlineColor', titleOutlineColor);
    localStorage.setItem('titleOutlineWidth', titleOutlineWidth.toString());
    localStorage.setItem('imageFrameWidth', imageFrameWidth.toString());
    localStorage.setItem('imageFrameHeight', imageFrameHeight.toString());
    localStorage.setItem('globalImageZoom', globalImageZoom.toString());
  }, [
    headerTitle,
    bgColor,
    headerPosition,
    comparisons,
    timelineBlocks,
    scriptText,
    duration,
    showSubtitles,
    subtitleY,
    subtitleColor,
    subtitleOutlineColor,
    subtitleOutlineWidth,
    subtitleFontSize,
    subtitleFontFamily,
    subtitleHighlightColor,
    subtitleHighlightStyle,
    subtitleMaxWidth,
    subtitleMaxLines,
    mascotPoses,
    mascotScale,
    mascotChromaKey,
    mascotChromaThreshold,
    mascotWhiteBacking,
    headerLogoUrl,
    logoFileName,
    titleFontSize,
    titleOutlineColor,
    titleOutlineWidth,
    imageFrameWidth,
    imageFrameHeight,
    globalImageZoom
  ]);

  // Redraw canvas on frame state update
  const triggerCanvasRedraw = () => {
    if (!canvasRef.current) return;

    const activeBlock = timelineBlocks.find(
      block => currentTime >= block.start && currentTime <= block.end
    );

    const frameState = {
      headerTitle,
      headerLogoUrl,
      bgColor,
      timelineBlocks,
      comparisons,
      subtitleText: activeBlock ? activeBlock.text : '',
      mascotPose: activeBlock ? activeBlock.pose : 'default',
      highlight: activeBlock ? activeBlock.highlight : 'none',
      blockStart: activeBlock ? activeBlock.start : 0,
      blockEnd: activeBlock ? activeBlock.end : 0,
      showSubtitles,
      subtitleY,
      subtitleColor,
      subtitleOutlineColor,
      subtitleOutlineWidth,
      subtitleFontSize,
      subtitleFontFamily,
      subtitleHighlightColor,
      subtitleHighlightStyle,
      subtitleMaxWidth,
      subtitleMaxLines,
      headerPosition,
      headerTitleColor,
      headerTitleFontSize,
      mascotScale,
      mascotY,
      mascotChromaKey,
      mascotChromaThreshold,
      mascotWhiteBacking,
      titleFontSize,
      titleOutlineColor,
      titleOutlineWidth,
      imageFrameWidth,
      imageFrameHeight,
      globalImageZoom
    };

    drawFrame(canvasRef.current, frameState, currentTime, loadedImagesRef.current);
  };

  useEffect(() => {
    triggerCanvasRedraw();
  }, [
    currentTime, 
    timelineBlocks, 
    comparisons, 
    headerTitle, 
    headerTitleColor,
    headerTitleFontSize,
    headerLogoUrl, 
    bgColor,
    showSubtitles,
    subtitleY,
    subtitleColor,
    subtitleOutlineColor,
    subtitleOutlineWidth,
    subtitleFontSize,
    subtitleFontFamily,
    subtitleHighlightColor,
    subtitleHighlightStyle,
    subtitleMaxWidth,
    subtitleMaxLines,
    headerPosition,
    mascotScale,
    mascotY,
    mascotChromaKey,
    mascotChromaThreshold,
    mascotWhiteBacking,
    titleFontSize,
    titleOutlineColor,
    titleOutlineWidth,
    imageFrameWidth,
    imageFrameHeight,
    globalImageZoom
  ]);

  // Helper tính trọng số âm tiết thực tế cho từ tiếng Anh, con số và từ tiếng Việt
  const getSpokenWeight = (text) => {
    if (!text) return 1;
    let weight = 0;
    const words = text.trim().split(/\s+/);
    for (const word of words) {
      const cleanWord = word.replace(/[^\w\d]/g, '');
      if (!cleanWord) continue;

      // 1. Chuỗi số (e.g. 365 -> "ba trăm sáu mươi lăm" = 5 âm tiết; 2026 -> 7 âm tiết)
      if (/^\d+[%]?$/.test(cleanWord)) {
        weight += Math.max(1, cleanWord.length * 1.6);
      } 
      // 2. Từ viết tắt in hoa (e.g. API -> "a-pê-i", USB, HTML)
      else if (/^[A-Z0-9]{2,5}$/.test(cleanWord)) {
        weight += cleanWord.length * 1.4;
      } 
      // 3. Mỗi từ thường = 1.0 âm tiết chuẩn (tiếng Việt hay từ tên riêng Alaska, Husky, Windows...)
      else {
        weight += 1.0;
      }
    }
    return Math.max(weight, 0.5);
  };

  // Proportional timings redistribution
  const redistributeTimings = (totalDuration) => {
    const totalWeight = timelineBlocks.reduce((sum, block) => sum + getSpokenWeight(block.text), 0);
    if (totalWeight === 0) return;

    let accumulated = 0;
    const updated = timelineBlocks.map(block => {
      const ratio = getSpokenWeight(block.text) / totalWeight;
      const blockDuration = totalDuration * ratio;
      const start = parseFloat(accumulated.toFixed(2));
      const end = parseFloat((accumulated + blockDuration).toFixed(2));
      accumulated += blockDuration;
      return { ...block, start, end };
    });

    setTimelineBlocks(updated);
  };

  // Bộ phân tích khoảng lặng và căn khớp nhịp dùng chung (Web Audio API PCM scanner)
  const runSilenceSyncWithUrl = async (targetUrl, targetDuration) => {
    if (!targetUrl) return;
    setIsProcessingAudio(true);
    setSilenceSyncError('');
    try {
      const isLocal = targetUrl.startsWith('blob:') || targetUrl.startsWith('data:');
      const requestUrl = isLocal ? targetUrl : `/cors-proxy?url=${encodeURIComponent(targetUrl)}`;
      const response = await fetch(requestUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      const rawData = audioBuffer.getChannelData(0); // Lấy kênh trái
      const sampleRate = audioBuffer.sampleRate;
      const audioDuration = (targetDuration && targetDuration !== Infinity && !isNaN(targetDuration)) ? targetDuration : audioBuffer.duration;
      
      // 1. Chia khung đo năng lượng RMS
      const isSimple = silenceSyncMode === 'simple';
      const windowSize = Math.floor(sampleRate * (isSimple ? 0.05 : 0.03)); // Simple: 50ms, DP: 30ms
      const stepSize = Math.floor(sampleRate * (isSimple ? 0.025 : 0.015));  // Simple: 25ms, DP: 15ms
      
      const rmsValues = [];
      let minRms = Infinity;
      let maxRms = 0;

      for (let i = 0; i < rawData.length - windowSize; i += stepSize) {
        let sum = 0;
        for (let j = 0; j < windowSize; j++) {
          sum += rawData[i + j] * rawData[i + j];
        }
        const rms = Math.sqrt(sum / windowSize);
        rmsValues.push({ time: (i + windowSize / 2) / sampleRate, rms });
        if (rms < minRms) minRms = rms;
        if (rms > maxRms) maxRms = rms;
      }

      // Ngưỡng phát hiện khoảng lặng tự động phân ứng thích nghi cho cả giọng Nữ (tần số cao/tiếng thở) và giọng Nam
      const dynamicThreshold = Math.max(0.008, minRms + (maxRms - minRms) * 0.12);

      const silences = [];
      let isSilent = false;
      let startSilence = 0;

      for (let k = 0; k < rmsValues.length; k++) {
        const { time, rms } = rmsValues[k];
        if (rms < dynamicThreshold) {
          if (!isSilent) {
            isSilent = true;
            startSilence = time;
          }
        } else {
          if (isSilent) {
            isSilent = false;
            const endSilence = time;
            const silenceDuration = endSilence - startSilence;
            // Bắt cả các khoảng ngắt câu nhanh từ 50ms trở lên cho giọng nữ/giọng đọc tốc độ cao
            if (silenceDuration >= 0.05) {
              silences.push({ start: startSilence, end: endSilence, mid: (startSilence + endSilence) / 2 });
            }
          }
        }
      }

      if (isSilent) {
        silences.push({ start: startSilence, end: audioDuration, mid: (startSilence + audioDuration) / 2 });
      }

      // Gộp các khoảng lặng bị đứt đoạn quá ngắn (< 80ms) do nhiễu micro, bảo toàn 100% các khoảng ngắt câu thực tế
      const cleanSilences = [];
      silences.forEach(s => {
        if (cleanSilences.length === 0) {
          cleanSilences.push(s);
        } else {
          const last = cleanSilences[cleanSilences.length - 1];
          const shouldMerge = (s.start - last.end < 0.08);
          if (shouldMerge) {
            last.end = s.end;
            last.mid = (last.start + s.end) / 2;
          } else {
            cleanSilences.push(s);
          }
        }
      });

      setDetectedSilencesCount(cleanSilences.length);

      const updated = [...timelineBlocks];
      const totalWeight = timelineBlocks.reduce((sum, b) => sum + getSpokenWeight(b.text), 0);
      const neededCount = timelineBlocks.length - 1;

      if (neededCount > 0 && totalWeight > 0) {
        const propTransitions = [];
        let acc = 0;
        for (let i = 0; i < neededCount; i++) {
          acc += (getSpokenWeight(timelineBlocks[i].text) / totalWeight) * audioDuration;
          propTransitions.push(acc);
        }

        const matchedTimes = [];
        let lastMatchIdx = -1;

        for (let i = 0; i < neededCount; i++) {
          const targetTime = propTransitions[i];
          let closest = null;
          let closestDist = Infinity;
          let closestIdx = -1;

          for (let sIdx = lastMatchIdx + 1; sIdx < cleanSilences.length; sIdx++) {
            const silence = cleanSilences[sIdx];
            const sDur = silence.end - silence.start;
            const dist = Math.abs(silence.mid - targetTime) - Math.min(1.8, sDur * 2.2);
            if (dist < closestDist) {
              closestDist = dist;
              closest = silence;
              closestIdx = sIdx;
            }
          }

          if (closest && Math.abs(closest.mid - targetTime) < 6.0) {
            const transitionTime = closest.start + Math.min(0.1, (closest.end - closest.start) * 0.25);
            matchedTimes.push(transitionTime);
            lastMatchIdx = closestIdx;
          } else {
            matchedTimes.push(targetTime);
          }
        }

        updated[0].start = 0;
        for (let i = 0; i < matchedTimes.length; i++) {
          const t = parseFloat(matchedTimes[i].toFixed(2));
          updated[i].end = t;
          updated[i + 1].start = t;
        }
        updated[updated.length - 1].end = parseFloat(audioDuration.toFixed(2));

        setTimelineBlocks(updated);
      }

      setDuration(audioDuration);
      setCurrentTime(0);
    } catch (err) {
      console.error('Lỗi khi khớp nhịp khoảng lặng:', err);
      setSilenceSyncError(err.message || 'Lỗi không xác định khi giải mã âm thanh (CORS / Lỗi file)');
      setDetectedSilencesCount(0);
      
      // Dự phòng
      const totalWeight = timelineBlocks.reduce((sum, b) => sum + getSpokenWeight(b.text), 0);
      if (totalWeight > 0) {
        let acc = 0;
        const fallbackBlocks = timelineBlocks.map(block => {
          const ratio = getSpokenWeight(block.text) / totalWeight;
          const blockDuration = targetDuration * ratio;
          const start = parseFloat(acc.toFixed(2));
          const end = parseFloat((acc + blockDuration).toFixed(2));
          acc += blockDuration;
          return { ...block, start, end };
        });
        setTimelineBlocks(fallbackBlocks);
      }
    } finally {
      setIsProcessingAudio(false);
    }
  };
 
  // Wrapper để gọi thủ công từ UI
  const handleAutoSyncSilence = async () => {
    if (!audioUrl) {
      alert('Vui lòng upload âm thanh hoặc tạo giọng đọc trước.');
      return;
    }
    await runSilenceSyncWithUrl(audioUrl, duration);
    alert('Đã tự động căn khớp nhịp phụ đề dựa trên các khoảng lặng trong giọng đọc!');
  };

  // Đánh dấu chuyển câu thủ công (Tap-to-Time)
  const handleTapSync = () => {
    if (!isPlaying) return;
    
    // Tìm câu phụ đề đang chạy tại currentTime
    const activeIdx = timelineBlocks.findIndex(
      b => currentTime >= b.start && currentTime <= b.end
    );
    
    if (activeIdx !== -1 && activeIdx < timelineBlocks.length - 1) {
      const t = parseFloat(currentTime.toFixed(2));
      const updated = [...timelineBlocks];
      
      // Đặt điểm kết thúc câu hiện tại và bắt đầu câu sau bằng thời điểm hiện tại
      updated[activeIdx].end = t;
      updated[activeIdx + 1].start = t;
      
      setTimelineBlocks(updated);
    }
  };

  // Lắng nghe phím tắt bàn phím ngoài vùng soạn thảo
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (
        document.activeElement.tagName === 'INPUT' || 
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.tagName === 'SELECT'
      ) {
        return;
      }
      
      if (e.key === '[') {
        e.preventDefault();
        handleTapSync();
      } else if (e.key === ' ') {
        e.preventDefault();
        handlePlayToggle();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, currentTime, timelineBlocks]);

  // Parser: splits raw chatbot text script into timeline beats and comparison blocks
  const handleParseScript = () => {
    if (!scriptText.trim()) {
      alert('Vui lòng nhập kịch bản.');
      return;
    }

    const lines = scriptText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l !== '');

    if (lines.length === 0) return;

    const parsedBlocks = [];
    const parsedComparisons = [];

    // Calculate initial estimated timeline duration (approx 6.5 characters per second)
    const totalChars = lines.reduce((sum, line) => sum + line.length, 0);
    const estimatedTotal = Math.max(10, totalChars * 0.155);

    let accumulatedTime = 0;

    // First, scan for declaration matching patterns "Đây là X" to create comparison items
    for (let i = 0; i < lines.length; i++) {
      const line1 = lines[i];
      const line2 = lines[i + 1];

      const match1 = line1.match(/^(đây là|day la)\s+(.+?)[.?!]*$/i);
      const match2 = line2 ? line2.match(/^(đây là|day la)\s+(.+?)[.?!]*$/i) : null;

      if (match1 && match2) {
        const leftTitle = match1[2].trim();
        const rightTitle = match2[2].trim();

        parsedComparisons.push({
          id: `comp-${Math.random().toString(36).substr(2, 9)}`,
          leftTitle,
          leftImageUrl: '',
          leftZoom: 100,
          leftColor: '#d93025',
          rightTitle,
          rightImageUrl: '',
          rightZoom: 100,
          rightColor: '#1b5e20',
          startIndex: i
        });
      }
    }

    // Fallback: If no "Đây là" declaration pair was matched, generate a default comparison round
    if (parsedComparisons.length === 0) {
      parsedComparisons.push({
        id: `comp-default`,
        leftTitle: 'Cột Trái',
        leftImageUrl: '',
        leftZoom: 100,
        leftColor: '#d93025',
        rightTitle: 'Cột Phải',
        rightImageUrl: '',
        rightZoom: 100,
        rightColor: '#1b5e20',
        startIndex: 0
      });
    }

    // Second, build timeline blocks and map gestures
    lines.forEach((line, index) => {
      const ratio = line.length / totalChars;
      const blockDuration = estimatedTotal * ratio;
      const start = parseFloat(accumulatedTime.toFixed(2));
      const end = parseFloat((accumulatedTime + blockDuration).toFixed(2));
      accumulatedTime += blockDuration;

      // Detect active comparison round
      const activeComp = [...parsedComparisons]
        .reverse()
        .find(c => c.startIndex <= index) || parsedComparisons[0];

      let pose = 'default';
      let highlight = 'none';

      const lineLower = line.toLowerCase();
      const relativeOffset = index - activeComp.startIndex;

      // Smart gesture and highlights mapping
      if (relativeOffset === 0) {
        pose = 'point_left';
        highlight = 'left';
      } else if (relativeOffset === 1) {
        pose = 'point_right';
        highlight = 'right';
      } else if (lineLower.includes('khác nhau') || lineLower.includes('khac nhau')) {
        pose = 'shrug';
        highlight = 'none';
      } else {
        const getCleanWords = (str) => (str || '').toLowerCase().replace(/[^\w\sàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/g, '').split(/\s+/).filter(w => w.length > 1);

        const leftWords = getCleanWords(activeComp.leftTitle);
        const rightWords = getCleanWords(activeComp.rightTitle);

        const leftDistinct = leftWords.filter(w => !rightWords.includes(w));
        const rightDistinct = rightWords.filter(w => !leftWords.includes(w));

        const matchesLeft = leftDistinct.some(w => lineLower.includes(w)) || (leftWords.length > 0 && lineLower.includes(activeComp.leftTitle.toLowerCase()));
        const matchesRight = rightDistinct.some(w => lineLower.includes(w)) || (rightWords.length > 0 && lineLower.includes(activeComp.rightTitle.toLowerCase()));

        if (matchesLeft && !matchesRight) {
          pose = 'point_left';
          highlight = 'left';
        } else if (matchesRight && !matchesLeft) {
          pose = 'point_right';
          highlight = 'right';
        } else {
          if (relativeOffset % 2 === 1) {
            pose = 'point_left';
            highlight = 'left';
          } else {
            pose = 'point_right';
            highlight = 'right';
          }
        }
      }

      parsedBlocks.push({
        id: `t-${Math.random().toString(36).substr(2, 9)}`,
        start,
        end,
        text: line,
        pose,
        highlight
      });
    });

    setTimelineBlocks(parsedBlocks);
    setComparisons(parsedComparisons);
    setDuration(estimatedTotal);
    setCurrentTime(0);
    setIsPlaying(false);
    
    // Auto switch to timeline beats tab to let user review
    setActiveTab('timeline');
    alert(`Đã nhận diện thành công: ${parsedComparisons.length} So Sánh & ${parsedBlocks.length} nhịp đọc!`);
  };

  // Add/Remove comparison rounds manually
  const handleAddComparison = () => {
    const nextStartIdx = timelineBlocks.length > 0 ? timelineBlocks.length : 0;
    const newComp = {
      id: `comp-${Math.random().toString(36).substr(2, 9)}`,
      leftTitle: 'Cột Trái mới',
      leftImageUrl: '',
      leftZoom: 100,
      leftColor: '#d93025',
      rightTitle: 'Cột Phải mới',
      rightImageUrl: '',
      rightZoom: 100,
      rightColor: '#1b5e20',
      startIndex: nextStartIdx
    };
    setComparisons([...comparisons, newComp]);
  };

  const handleUpdateComparison = (id, field, value) => {
    const updated = comparisons.map(c => {
      if (c.id === id) {
        return { ...c, [field]: value };
      }
      return c;
    });
    setComparisons(updated);
  };

  const handleDeleteComparison = (id) => {
    if (comparisons.length <= 1) {
      alert('Phải giữ lại tối thiểu 1 block so sánh.');
      return;
    }
    setComparisons(comparisons.filter(c => c.id !== id));
  };

  // Image uploads for comparisons
  const handleCompImageUpload = (compId, side, e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      handleUpdateComparison(compId, `${side}ImageUrl`, url);
      cacheImage(url, url);
      saveImageToStorage(url, file);
    }
  };

  // Mascot custom pose uploads
  const handleMascotPoseUpload = (poseKey, e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setMascotPoses(prev => {
        const updatedPoses = { ...prev, [poseKey]: url };
        safeSaveMascotPoses(updatedPoses);
        
        // Auto update active channel profile in channelProfiles array
        setChannelProfiles(prevProfiles => {
          const updated = prevProfiles.map(p => {
            if (p.id === activeChannelId) {
              return { ...p, mascotPoses: updatedPoses };
            }
            return p;
          });
          safeSaveChannelProfiles(updated);
          return updated;
        });

        return updatedPoses;
      });
      cacheImage(poseKey, url);
    }
  };

  // Upload and process Mascot Sprite Sheet (Horizontal 4-pose sheet on white background)
  const handleSpriteSheetUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setSpriteFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        const w = img.width;
        const h = img.height;
        const segmentW = Math.floor(w / 4);
        const segmentH = h;

        const posesKeys = ['default', 'point_left', 'point_right', 'shrug'];
        const newPoses = { ...mascotPoses };

        for (let idx = 0; idx < 4; idx++) {
          const offCanvas = document.createElement('canvas');
          offCanvas.width = segmentW;
          offCanvas.height = segmentH;
          const offCtx = offCanvas.getContext('2d');

          // Draw the segment
          offCtx.drawImage(img, idx * segmentW, 0, segmentW, segmentH, 0, 0, segmentW, segmentH);

          // Clear white background with smooth feathering
          const imgData = offCtx.getImageData(0, 0, segmentW, segmentH);
          const data = imgData.data;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // White-key thresholding with transparency falloff
            const minColor = Math.min(r, g, b);
            if (minColor > 215) {
              const alphaFactor = (255 - minColor) / (255 - 215); // 0 (at 255) to 1 (at 215)
              data[i + 3] = Math.min(data[i + 3], Math.floor(alphaFactor * 255));
            }
          }
          offCtx.putImageData(imgData, 0, 0);

          // Convert to data url
          const dataUrl = offCanvas.toDataURL('image/png');
          newPoses[posesKeys[idx]] = dataUrl;
          
          // Cache the new image data URL
          cacheImage(posesKeys[idx], dataUrl);
        }

        setMascotPoses(newPoses);
        safeSaveMascotPoses(newPoses);

        // Auto update active channel profile in channelProfiles array
        setChannelProfiles(prevProfiles => {
          const updated = prevProfiles.map(p => {
            if (p.id === activeChannelId) {
              return { ...p, mascotPoses: newPoses, spriteFileName: file.name };
            }
            return p;
          });
          safeSaveChannelProfiles(updated);
          return updated;
        });

        alert('Đã tải ảnh Sprite Sheet Mascot, tự động cắt 4 tư thế và lưu riêng cho Kênh hiện tại thành công!');
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  };

  // Channel Logo Upload
  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setHeaderLogoUrl(url);
      setLogoFileName(file.name);
      localStorage.setItem('headerLogoUrl', url);
      localStorage.setItem('logoFileName', file.name);

      // Auto update active channel profile in channelProfiles array
      setChannelProfiles(prevProfiles => {
        const updated = prevProfiles.map(p => {
          if (p.id === activeChannelId) {
            return { ...p, headerLogoUrl: url, logoFileName: file.name };
          }
          return p;
        });
        localStorage.setItem('channel_profiles', JSON.stringify(updated));
        return updated;
      });

      cacheImage(url, url);
      saveImageToStorage(url, file);
    }
  };

  // Audio / Video VO Upload
  const handleAudioUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      setAudioFileName(file.name);
      setIsPlaying(false);
      setCurrentTime(0);

      // Persist to IndexedDB
      saveAudioToStorage(file, file.name);

      // Đọc thời lượng âm thanh và tự động căn khớp nhịp khoảng lặng
      const tempAudio = new Audio(url);
      tempAudio.onloadedmetadata = async () => {
        await runSilenceSyncWithUrl(url, tempAudio.duration);
        alert('Đã tải âm thanh và tự động đồng bộ nhịp phụ đề!');
      };
    }
  };

  // Subtitle/timeline editing handlers
  const handleUpdateTimelineBlock = (id, field, value) => {
    const updated = timelineBlocks.map(block => {
      if (block.id === id) {
        let val = value;
        if (field === 'start' || field === 'end') {
          val = Math.max(0, parseFloat(value) || 0);
        }
        return { ...block, [field]: val };
      }
      return block;
    });
    setTimelineBlocks(updated.sort((a, b) => a.start - b.start));
    
    const maxEnd = Math.max(...updated.map(b => b.end), 5);
    if (maxEnd > duration) setDuration(maxEnd);
  };

  const handleDeleteTimelineBlock = (id) => {
    setTimelineBlocks(timelineBlocks.filter(b => b.id !== id));
  };

  const handleAddTimelineBlock = () => {
    const lastBlock = timelineBlocks[timelineBlocks.length - 1];
    const start = lastBlock ? lastBlock.end : 0;
    const end = start + 2.5;

    const newBlock = {
      id: `t-${Math.random().toString(36).substr(2, 9)}`,
      start,
      end,
      text: 'Câu phụ đề mới...',
      pose: 'default',
      highlight: 'none'
    };

    setTimelineBlocks([...timelineBlocks, newBlock]);
    if (end > duration) setDuration(end);
  };

  // Timeline scrubber adjustments
  const handleTimelineScrub = (e) => {
    const t = parseFloat(e.target.value);
    setCurrentTime(t);
    if (audioRef.current) {
      audioRef.current.currentTime = t;
    }
  };

  const handlePlayToggle = () => {
    if (isPlaying) {
      if (audioRef.current) audioRef.current.pause();
      setIsPlaying(false);
    } else {
      if (audioRef.current) {
        audioRef.current.currentTime = currentTime;
        audioRef.current.play().catch(err => console.error(err));
      }
      setIsPlaying(true);
    }
  };

  // Save / Load project JSON helpers
  const handleSaveProject = () => {
    const projectData = {
      version: '2.1',
      headerTitle,
      bgColor,
      comparisons,
      timelineBlocks,
      scriptText,
      showSubtitles,
      subtitleY,
      subtitleColor,
      subtitleOutlineColor,
      subtitleOutlineWidth,
      subtitleFontSize,
      subtitleFontFamily,
      subtitleHighlightColor,
      subtitleHighlightStyle,
      subtitleMaxWidth,
      subtitleMaxLines,
      headerPosition,
      mascotPoses,
      mascotScale,
      titleFontSize,
      titleOutlineColor,
      titleOutlineWidth,
      imageFrameWidth,
      imageFrameHeight,
      globalImageZoom,
      ytClientId,
      ytClientSecret,
      ytRefreshToken,
      customFilename
    };
    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${customFilename || 'video_so_sanh'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleLoadProject = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Clear old cached audio and images on new project load
    clearAudioFromStorage();
    clearImagesFromStorage();
    setAudioUrl('');
    setAudioFileName('');

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const projectData = JSON.parse(evt.target.result);
        if (projectData.headerTitle) setHeaderTitle(projectData.headerTitle);
        if (projectData.bgColor) setBgColor(projectData.bgColor);
        if (projectData.comparisons) setComparisons(projectData.comparisons);
        if (projectData.timelineBlocks) {
          setTimelineBlocks(projectData.timelineBlocks);
          const maxEnd = Math.max(...projectData.timelineBlocks.map(b => b.end), 5);
          setDuration(maxEnd);
        }
        if (projectData.scriptText) setScriptText(projectData.scriptText);

        // Cấu hình phụ đề tùy biến
        if (projectData.showSubtitles !== undefined) setShowSubtitles(projectData.showSubtitles);
        if (projectData.subtitleY !== undefined) setSubtitleY(projectData.subtitleY);
        if (projectData.subtitleColor !== undefined) setSubtitleColor(projectData.subtitleColor);
        if (projectData.subtitleOutlineColor !== undefined) setSubtitleOutlineColor(projectData.subtitleOutlineColor);
        if (projectData.subtitleOutlineWidth !== undefined) setSubtitleOutlineWidth(projectData.subtitleOutlineWidth);
        if (projectData.subtitleFontSize !== undefined) setSubtitleFontSize(projectData.subtitleFontSize);
        if (projectData.subtitleFontFamily !== undefined) setSubtitleFontFamily(projectData.subtitleFontFamily);
        if (projectData.subtitleHighlightColor !== undefined) setSubtitleHighlightColor(projectData.subtitleHighlightColor);
        if (projectData.subtitleHighlightStyle !== undefined) setSubtitleHighlightStyle(projectData.subtitleHighlightStyle);
        if (projectData.subtitleMaxWidth !== undefined) setSubtitleMaxWidth(projectData.subtitleMaxWidth);
        if (projectData.subtitleMaxLines !== undefined) setSubtitleMaxLines(projectData.subtitleMaxLines);
        if (projectData.headerPosition !== undefined) setHeaderPosition(projectData.headerPosition);

        // Cấu hình tiêu đề cột tùy biến
        if (projectData.titleFontSize !== undefined) setTitleFontSize(projectData.titleFontSize);
        if (projectData.titleOutlineColor !== undefined) setTitleOutlineColor(projectData.titleOutlineColor);
        if (projectData.titleOutlineWidth !== undefined) setTitleOutlineWidth(projectData.titleOutlineWidth);

        // Cấu hình kích thước khung ảnh tùy biến
        if (projectData.imageFrameWidth !== undefined) setImageFrameWidth(projectData.imageFrameWidth);
        if (projectData.imageFrameHeight !== undefined) setImageFrameHeight(projectData.imageFrameHeight);
        if (projectData.globalImageZoom !== undefined) setGlobalImageZoom(projectData.globalImageZoom);
        if (projectData.ytClientId !== undefined) setYtClientId(projectData.ytClientId);
        if (projectData.ytClientSecret !== undefined) setYtClientSecret(projectData.ytClientSecret);
        if (projectData.ytRefreshToken !== undefined) setYtRefreshToken(projectData.ytRefreshToken);
        if (projectData.customFilename !== undefined) setCustomFilename(projectData.customFilename);

        // Khôi phục ảnh Mascot tùy biến
        if (projectData.mascotPoses) {
          setMascotPoses(projectData.mascotPoses);
          Object.entries(projectData.mascotPoses).forEach(([pose, url]) => {
            cacheImage(pose, url);
          });
        }

        // Khôi phục kích thước Mascot
        if (projectData.mascotScale !== undefined) {
          setMascotScale(projectData.mascotScale);
        }

        setCurrentTime(0);
        setIsPlaying(false);
      } catch (err) {
        alert('Tệp tin không hợp lệ: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  const handleLoadProjectConfig = (config) => {
    if (!config) return;
    try {
      if (config.headerTitle !== undefined) setHeaderTitle(config.headerTitle);
      if (config.customFilename !== undefined) setCustomFilename(config.customFilename);
      if (config.headerLogoUrl !== undefined) setHeaderLogoUrl(config.headerLogoUrl);
      if (config.logoFileName !== undefined) setLogoFileName(config.logoFileName);
      if (config.bgColor !== undefined) setBgColor(config.bgColor);
      if (config.headerPosition !== undefined) setHeaderPosition(config.headerPosition);
      if (config.headerTitleColor !== undefined) setHeaderTitleColor(config.headerTitleColor);
      if (config.headerTitleFontSize !== undefined) setHeaderTitleFontSize(config.headerTitleFontSize);
      if (config.comparisons !== undefined) setComparisons(config.comparisons);
      if (config.timelineBlocks !== undefined) {
        setTimelineBlocks(config.timelineBlocks);
        const maxEnd = Math.max(...config.timelineBlocks.map(b => b.end), 5);
        setDuration(maxEnd);
      }
      if (config.scriptText !== undefined) setScriptText(config.scriptText);
      if (config.mascotScale !== undefined) setMascotScale(config.mascotScale);
      if (config.mascotY !== undefined) setMascotY(config.mascotY);
      if (config.mascotChromaKey !== undefined) setMascotChromaKey(config.mascotChromaKey);
      if (config.mascotChromaThreshold !== undefined) setMascotChromaThreshold(config.mascotChromaThreshold);
      if (config.ttsProvider !== undefined) setTtsProvider(config.ttsProvider);
      if (config.selectedVoiceId !== undefined) setSelectedVoiceId(config.selectedVoiceId);
      if (config.vclipVoiceId !== undefined) setVclipVoiceId(config.vclipVoiceId);
      if (config.vclipSpeed !== undefined) setVclipSpeed(config.vclipSpeed);
      if (config.lucyLabVoiceId !== undefined) setLucyLabVoiceId(config.lucyLabVoiceId);
      if (config.lucyLabSpeed !== undefined) setLucyLabSpeed(config.lucyLabSpeed);
      if (config.stability !== undefined) setStability(config.stability);
      if (config.similarityBoost !== undefined) setSimilarityBoost(config.similarityBoost);
      if (config.styleExaggeration !== undefined) setStyleExaggeration(config.styleExaggeration);
      if (config.useSpeakerBoost !== undefined) setUseSpeakerBoost(config.useSpeakerBoost);
      if (config.silenceThreshold !== undefined) setSilenceThreshold(config.silenceThreshold);
      if (config.minSilenceDuration !== undefined) setMinSilenceDuration(config.minSilenceDuration);
      if (config.showSubtitles !== undefined) setShowSubtitles(config.showSubtitles);
      if (config.subtitleY !== undefined) setSubtitleY(config.subtitleY);
      if (config.subtitleColor !== undefined) setSubtitleColor(config.subtitleColor);
      if (config.subtitleOutlineColor !== undefined) setSubtitleOutlineColor(config.subtitleOutlineColor);
      if (config.subtitleOutlineWidth !== undefined) setSubtitleOutlineWidth(config.subtitleOutlineWidth);
      if (config.subtitleFontSize !== undefined) setSubtitleFontSize(config.subtitleFontSize);
      if (config.subtitleFontFamily !== undefined) setSubtitleFontFamily(config.subtitleFontFamily);
      if (config.subtitleHighlightColor !== undefined) setSubtitleHighlightColor(config.subtitleHighlightColor);
      if (config.subtitleHighlightStyle !== undefined) setSubtitleHighlightStyle(config.subtitleHighlightStyle);
      if (config.subtitleMaxWidth !== undefined) setSubtitleMaxWidth(config.subtitleMaxWidth);
      if (config.subtitleMaxLines !== undefined) setSubtitleMaxLines(config.subtitleMaxLines);
      if (config.titleFontSize !== undefined) setTitleFontSize(config.titleFontSize);
      if (config.titleOutlineColor !== undefined) setTitleOutlineColor(config.titleOutlineColor);
      if (config.titleOutlineWidth !== undefined) setTitleOutlineWidth(config.titleOutlineWidth);
      if (config.imageFrameWidth !== undefined) setImageFrameWidth(config.imageFrameWidth);
      if (config.imageFrameHeight !== undefined) setImageFrameHeight(config.imageFrameHeight);
      if (config.globalImageZoom !== undefined) setGlobalImageZoom(config.globalImageZoom);

      if (config.mascotPoses) {
        setMascotPoses(config.mascotPoses);
        Object.entries(config.mascotPoses).forEach(([pose, url]) => {
          cacheImage(pose, url);
        });
      }

      if (config.audioFileName) {
        getAudioFromStorage(config.audioFileName).then(record => {
          if (record && record.blob) {
            const localUrl = URL.createObjectURL(record.blob);
            setAudioUrl(localUrl);
            setAudioFileName(config.audioFileName);
          } else {
            if (config.audioUrl && config.audioUrl.startsWith('data:')) {
              setAudioUrl(config.audioUrl);
              setAudioFileName(config.audioFileName);
            } else {
              setAudioUrl('');
              setAudioFileName('');
              alert('Lưu ý: Không tìm thấy tệp âm thanh gốc trong bộ nhớ tạm trình duyệt (do tệp được tạo trước khi nâng cấp hệ thống). Bạn vui lòng bấm nút "Tạo Voice AI" để tạo lại âm thanh trước khi xuất video nhé!');
            }
          }
        }).catch(() => {
          setAudioUrl('');
          setAudioFileName('');
        });
      } else {
        setAudioUrl('');
        setAudioFileName('');
      }

      setCurrentTime(0);
      setIsPlaying(false);
      alert('Đã khôi phục thành công cấu hình của bài đăng này vào Workflow!');
      setActiveTab('content');
    } catch (err) {
      alert('Không thể khôi phục cấu hình: ' + err.message);
    }
  };

  const exportCanvasRef = useRef(null);

  // Bật/Tắt âm thanh preview trong lúc render video
  const handleToggleExportMute = () => {
    const newMuted = !isExportMuted;
    setIsExportMuted(newMuted);
    window.isExportMuted = newMuted;
    if (window.exportMonitorGain && window.exportMonitorGain.gain) {
      window.exportMonitorGain.gain.value = newMuted ? 0 : 0.4;
    }
    if (window.exportPreviewAudio) {
      window.exportPreviewAudio.muted = newMuted;
    }
  };

  // Kích hoạt tiến trình xuất bản video So Sánh chất lượng cao
  const handleRenderVideo = () => {
    setIsPlaying(false);
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch (err) {
        console.warn('Lỗi khi tạm dừng âm thanh editor:', err);
      }
    }
    setCurrentTime(0);
    setIsExporting(true);
    setExportProgress(1);
    setExportedVideoUrl('');
  };

  // Tự động chạy tiến trình export ngay khi modal hiển thị canvas trong DOM
  useEffect(() => {
    if (!isExporting) return;

    const startExportSequence = async () => {
      // Đợi tối đa 1.5 giây cho canvas render-overlay được mount
      let canvasEl = exportCanvasRef.current;
      for (let i = 0; i < 15; i++) {
        if (canvasEl) break;
        await new Promise(r => setTimeout(r, 100));
        canvasEl = exportCanvasRef.current;
      }

      if (!canvasEl) {
        alert('Không tìm thấy màn hình preview để xuất video');
        setIsExporting(false);
        return;
      }

      // Mở khóa AudioContext bằng cử chỉ người dùng trước các hoạt động bất đồng bộ
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        try {
          const dummyCtx = new AudioContextClass();
          if (dummyCtx.state === 'suspended') {
            await dummyCtx.resume();
          }
        } catch (e) {
          console.warn('Unlock audio context failed:', e);
        }
      }

      await exportVideo({
        canvas: canvasEl,
        state: { 
          headerTitle, 
          headerLogoUrl, 
          bgColor, 
          comparisons, 
          timelineBlocks,
          showSubtitles,
          subtitleY,
          subtitleColor,
          subtitleOutlineColor,
          subtitleOutlineWidth,
          subtitleFontSize,
          subtitleFontFamily,
          subtitleHighlightColor,
          subtitleHighlightStyle,
          subtitleMaxWidth,
          subtitleMaxLines,
          headerPosition,
          headerTitleColor,
          headerTitleFontSize,
          mascotScale,
          mascotY,
          mascotChromaKey,
          mascotChromaThreshold,
          mascotWhiteBacking,
          titleFontSize,
          titleOutlineColor,
          titleOutlineWidth,
          imageFrameWidth,
          imageFrameHeight,
          globalImageZoom
        },
        timelineBlocks,
        audioUrl,
        mascotPoses,
        onProgress: (progress) => setExportProgress(progress),
        onComplete: ({ url, extension }) => {
          setExportedVideoUrl(url);
          setExportedExt(extension);
          setIsExporting(false);
          notifyTelegramPublish(headerTitle || 'Video so sánh');
        },
        onError: (err) => {
          alert('Lỗi xuất video: ' + err);
          setIsExporting(false);
        }
      });
    };

    startExportSequence();
  }, [isExporting]);

  // Social Media Scheduling Handlers
  const handleToggleFbConnect = () => {
    if (fbConnected) {
      setFbConnected(false);
      alert('Đã hủy liên kết Facebook.');
    } else {
      setActiveConnectModal('facebook');
    }
  };

  const handleToggleYtConnect = () => {
    if (ytConnected) {
      setYtConnected(false);
      alert('Đã hủy liên kết YouTube.');
    } else {
      setActiveConnectModal('youtube');
    }
  };

  const handleToggleTtConnect = () => {
    if (ttConnected) {
      setTtConnected(false);
      alert('Đã hủy liên kết TikTok.');
    } else {
      setActiveConnectModal('tiktok');
    }
  };

  const handleSaveFbCredentials = (e) => {
    e.preventDefault();
    const pId = fbPageId.trim();
    const token = fbAccessToken.trim();
    if (!pId || !token) {
      alert('Vui lòng nhập đầy đủ Page ID và Access Token.');
      return;
    }
    setFbPageId(pId);
    setFbAccessToken(token);
    setFbConnected(true);
    setActiveConnectModal(null);
    alert('Đã kết nối tài khoản Facebook thành công!');
  };

  const handleSaveYtCredentials = (e) => {
    e.preventDefault();
    const chId = ytChannelId.trim();
    const token = ytAccessToken.trim();
    const cId = ytClientId.trim();
    const cSecret = ytClientSecret.trim();
    const rToken = ytRefreshToken.trim();

    if (!chId) {
      alert('Vui lòng nhập Channel ID.');
      return;
    }
    if (!token && (!cId || !cSecret || !rToken)) {
      alert('Vui lòng cung cấp Access Token HOẶC điền đầy đủ (Client ID + Client Secret + Refresh Token) để tự động làm mới mã.');
      return;
    }
    setYtChannelId(chId);
    setYtAccessToken(token);
    setYtClientId(cId);
    setYtClientSecret(cSecret);
    setYtRefreshToken(rToken);
    setYtConnected(true);
    setActiveConnectModal(null);
    alert('Đã kết nối tài khoản YouTube thành công!');
  };

  const handleSaveTtCredentials = (e) => {
    e.preventDefault();
    const sId = ttSessionId.trim();
    const token = ttAccessToken.trim();
    if (!sId || !token) {
      alert('Vui lòng nhập đầy đủ Session ID và Access Token.');
      return;
    }
    setTtSessionId(sId);
    setTtAccessToken(token);
    setTtConnected(true);
    setActiveConnectModal(null);
    alert('Đã kết nối tài khoản TikTok thành công!');
  };

  const handleAddManualVideo = () => {
    if (!manualVideoId.trim()) {
      alert('Vui lòng nhập Video/Reel ID.');
      return;
    }
    
    // Tạo bài đăng dummy với ID thủ công để bot theo dõi bình luận
    const dummyPost = {
      id: `manual-${Date.now()}`,
      caption: 'Video theo dõi thủ công',
      platforms: ['facebook'],
      mode: 'now',
      date: new Date().toLocaleString('vi-VN'),
      status: 'published',
      videoUrl: '',
      headerTitle: `Video ID: ${manualVideoId.trim()}`,
      postId: manualVideoId.trim(),
      postIds: { facebook: manualVideoId.trim() }
    };
    
    setScheduledPosts(prev => [dummyPost, ...prev]);
    setManualVideoId('');
    alert(`Đã thêm Video ID: ${manualVideoId.trim()} vào danh sách theo dõi bình luận!`);
  };

  const handleAddSchedule = async () => {
    if (!exportedVideoUrl) {
      alert('Vui lòng tạo (render) video trước khi đăng.');
      return;
    }
    if (!publishCaption.trim()) {
      alert('Vui lòng nhập mô tả / nội dung đăng bài.');
      return;
    }
    const selectedPlatforms = Object.keys(publishPlatforms).filter(k => publishPlatforms[k]);
    if (selectedPlatforms.length === 0) {
      alert('Vui lòng chọn ít nhất một nền tảng để đăng.');
      return;
    }

    const connectedPlatforms = [];
    if (publishPlatforms.facebook && !fbConnected) connectedPlatforms.push('Facebook');
    if (publishPlatforms.youtube && !ytConnected) connectedPlatforms.push('YouTube');
    if (publishPlatforms.tiktok && !ttConnected) connectedPlatforms.push('TikTok');

    if (connectedPlatforms.length > 0) {
      alert(`Vui lòng kết nối tài khoản cho các nền tảng: ${connectedPlatforms.join(', ')} trước khi đặt lịch.`);
      return;
    }

    const newPostId = `post-${Date.now()}`;
    const newPost = {
      id: newPostId,
      caption: publishCaption,
      platforms: selectedPlatforms,
      mode: publishMode,
      date: publishMode === 'schedule' ? scheduleDate.replace('T', ' ') : new Date().toLocaleString('vi-VN'),
      status: publishMode === 'schedule' ? 'pending' : 'publishing',
      videoUrl: exportedVideoUrl || '',
      headerTitle: headerTitle,
      projectConfig: {
        headerTitle,
        customFilename,
        headerLogoUrl,
        logoFileName,
        bgColor,
        headerPosition,
        headerTitleColor,
        headerTitleFontSize,
        comparisons,
        timelineBlocks,
        scriptText,
        mascotScale,
        mascotY,
        mascotChromaKey,
        mascotChromaThreshold,
        duration,
        ttsProvider,
        selectedVoiceId,
        vclipVoiceId,
        vclipSpeed,
        lucyLabVoiceId,
        lucyLabSpeed,
        stability,
        similarityBoost,
        styleExaggeration,
        useSpeakerBoost,
        silenceThreshold,
        minSilenceDuration,
        showSubtitles,
        subtitleY,
        subtitleColor,
        subtitleOutlineColor,
        subtitleOutlineWidth,
        subtitleFontSize,
        subtitleFontFamily,
        subtitleHighlightColor,
        subtitleHighlightStyle,
        subtitleMaxWidth,
        subtitleMaxLines,
        titleFontSize,
        titleOutlineColor,
        titleOutlineWidth,
        imageFrameWidth,
        imageFrameHeight,
        globalImageZoom,
        audioFileName,
        audioUrl,
        mascotPoses
      }
    };

    // Thêm bài đăng vào danh sách hiển thị
    setScheduledPosts(prev => [newPost, ...prev]);

    // Lưu tệp video vào IndexedDB dưới ổ cứng để phục vụ tính năng hẹn giờ đăng tự động
    try {
      const videoBlob = await fetch(exportedVideoUrl).then(r => r.blob());
      await saveVideoToStorage(newPostId, videoBlob);
    } catch (err) {
      console.error('Lỗi khi lưu tệp video vào IndexedDB:', err);
    }

    if (publishMode === 'schedule') {
      setPublishCaption('');
      alert('Đã lên lịch đăng video thành công! Bài viết đang ở trạng thái chờ.');
      return;
    }

    // Đăng trực tiếp ngay lập tức
    setIsPublishing(true);
    let fbPostId = '';
    const postIds = {};
    try {
      for (const platform of selectedPlatforms) {
        setPublishingStatus(`Đang đăng lên ${platform === 'facebook' ? 'Facebook Reels' : platform}...`);
        
        if (platform === 'facebook') {
          // 1. Khởi tạo phiên upload Reel lên Page (gọi qua proxy /fb-api)
          const startRes = await fetch(`/fb-api/v21.0/${fbPageId}/video_reels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              access_token: fbAccessToken,
              upload_phase: 'start'
            })
          });
          
          if (!startRes.ok) {
            const errData = await startRes.json();
            throw new Error(`Khởi tạo FB Reel lỗi: ${errData.error?.message || startRes.statusText}`);
          }
          
          const startData = await startRes.json();
          const { video_id, upload_url } = startData;
          
          // 2. Fetch binary video blob từ URL cục bộ
          setPublishingStatus('Đang chuẩn bị file video...');
          const videoBlob = await fetch(exportedVideoUrl).then(r => r.blob());
          
          // 3. Upload file video nhị phân lên Meta Server thông qua Proxy phù hợp để tránh CORS
          setPublishingStatus('Đang truyền tải video lên server Facebook...');
          let proxyUploadUrl = upload_url;
          if (upload_url.includes('video-rupload.facebook.com')) {
            proxyUploadUrl = upload_url.replace('https://video-rupload.facebook.com', '/fb-upload');
          } else if (upload_url.includes('rupload.facebook.com')) {
            proxyUploadUrl = upload_url.replace('https://rupload.facebook.com', '/fb-rupload');
          }

          const uploadRes = await fetch(proxyUploadUrl, {
            method: 'POST',
            headers: {
              'Authorization': `OAuth ${fbAccessToken}`,
              'offset': '0',
              'file_size': videoBlob.size.toString(),
              'Content-Type': 'application/octet-stream'
            },
            body: videoBlob
          });
          
          if (!uploadRes.ok) {
            const errData = await uploadRes.json();
            throw new Error(`Upload video FB lỗi: ${errData.error?.message || uploadRes.statusText}`);
          }
          
          // 4. Hoàn tất & Xuất bản bài viết (gọi qua proxy /fb-api)
          setPublishingStatus('Đang xuất bản Reels lên Fanpage...');
          const finishRes = await fetch(`/fb-api/v21.0/${fbPageId}/video_reels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              access_token: fbAccessToken,
              upload_phase: 'finish',
              video_id: video_id,
              video_state: 'PUBLISHED',
              description: publishCaption
            })
          });
          
          if (!finishRes.ok) {
            const errData = await finishRes.json();
            throw new Error(`Hoàn tất xuất bản FB lỗi: ${errData.error?.message || finishRes.statusText}`);
          }

          const finishData = await finishRes.json();
          const fbPostIdValue = finishData.fb_id || finishData.id || video_id;
          fbPostId = fbPostIdValue;
          postIds.facebook = fbPostIdValue;
        } else if (platform === 'youtube') {
          let activeToken = ytAccessToken;
          if (ytClientId.trim() && ytClientSecret.trim() && ytRefreshToken.trim()) {
            setPublishingStatus('Đang tự động làm mới YouTube Access Token...');
            try {
              // Call Google OAuth Token endpoint via proxy
              const tokenRes = await fetch('/google-token/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  client_id: ytClientId.trim(),
                  client_secret: ytClientSecret.trim(),
                  refresh_token: ytRefreshToken.trim(),
                  grant_type: 'refresh_token'
                })
              });
              if (!tokenRes.ok) {
                const errData = await tokenRes.json();
                throw new Error(errData.error_description || errData.error || tokenRes.statusText);
              }
              const tokenData = await tokenRes.json();
              activeToken = tokenData.access_token;
              // Save it to state and localStorage for subsequent requests in the same session
              setYtAccessToken(activeToken);
              localStorage.setItem('yt_access_token', activeToken);
              setPublishingStatus('Làm mới YouTube Token thành công!');
            } catch (refreshErr) {
              throw new Error(`Không thể tự động gia hạn YouTube Token: ${refreshErr.message}`);
            }
          }

          // Now, do the actual YouTube Video Upload (Shorts)
          setPublishingStatus('Đang chuẩn bị file video cho YouTube...');
          const videoBlob = await fetch(exportedVideoUrl).then(r => r.blob());

          setPublishingStatus('Đang tải video lên YouTube Shorts...');
          const metadata = {
            snippet: {
              title: publishCaption.substring(0, 100) || 'Video So Sanh',
              description: publishCaption,
              tags: ['shorts', 'videososanh'],
              categoryId: '22' // People & Blogs
            },
            status: {
              privacyStatus: 'public',
              selfDeclaredMadeForKids: false
            }
          };

          const formData = new FormData();
          formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
          formData.append('file', videoBlob);

          const uploadRes = await fetch('/youtube-api/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${activeToken}`
            },
            body: formData
          });

          if (!uploadRes.ok) {
            const errData = await uploadRes.json();
            throw new Error(`Tải lên YouTube thất bại: ${errData.error?.message || uploadRes.statusText}`);
          }

          const uploadData = await uploadRes.json();
          const ytVideoId = uploadData.id;
          fbPostId = ytVideoId;
          postIds.youtube = ytVideoId;
        } else {
          // Giả lập tiến trình upload cho TikTok
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Cập nhật trạng thái thành công kèm ID bài viết để AI bot quản lý
      setScheduledPosts(prev => prev.map(p => p.id === newPostId ? { ...p, status: 'published', postId: fbPostId, postIds } : p));
      setPublishCaption('');
      alert('Đã xuất bản video thành công lên các mạng xã hội!');
    } catch (error) {
      console.error(error);
      setScheduledPosts(prev => prev.map(p => p.id === newPostId ? { ...p, status: 'failed' } : p));
      alert(`Đăng bài thất bại: ${error.message}`);
    } finally {
      setIsPublishing(false);
      setPublishingStatus('');
    }
  };

  const handleCheckFbReelStatus = async (post) => {
    const fbId = post.postIds?.facebook || post.postId;
    if (!fbId) {
      alert('Không tìm thấy Facebook Video ID của bài đăng này!');
      return;
    }
    try {
      const res = await fetch(`/fb-api/v21.0/${fbId}?fields=status&access_token=${fbAccessToken}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || res.statusText || 'Lỗi kết nối Facebook');
      }
      const data = await res.json();
      console.log('FB Reel Status Check:', data);
      
      const videoStatus = data.status?.video_status;
      const progress = data.status?.processing_progress;
      
      let statusTextVi = 'Chưa xác định';
      if (videoStatus === 'ready') statusTextVi = 'Sẵn sàng (Đã đăng thành công!)';
      else if (videoStatus === 'processing') statusTextVi = `Đang xử lý ngầm (Đang encode... ${progress !== undefined ? progress + '%' : ''})`;
      else if (videoStatus === 'error') statusTextVi = 'Lỗi xử lý ngầm (Facebook từ chối hoặc video lỗi)';
      else if (videoStatus === 'uploading') statusTextVi = 'Đang tải lên';
      else if (videoStatus) statusTextVi = `${videoStatus}`;

      alert(`[Facebook Reels Status Check]\n\n` +
            `ID video: ${fbId}\n` +
            `Trạng thái Reels: ${statusTextVi}`);
    } catch (err) {
      alert(`Kiểm tra thất bại: ${err.message}`);
    }
  };

  const handleDeleteSchedule = (id) => {
    if (confirm('Bạn có chắc chắn muốn xóa bài đăng này khỏi lịch trình?')) {
      setScheduledPosts(scheduledPosts.filter(p => p.id !== id));
    }
  };

  return (
    <div className="app-container">
      {/* Header Bar */}
      <header className="app-header">
        <div className="logo-section">
          <Sparkles className="logo-icon" size={26} />
          <h1 className="app-title">TỰ ĐỘNG HÓA VIDEO SO SÁNH</h1>
        </div>

        <div className="actions-bar">
          <button className="btn btn-secondary btn-sm" onClick={handleSaveProject}>
            <Save size={14} /> Lưu dự án
          </button>
          
          <div className="file-upload-wrapper" style={{ width: 'auto' }}>
            <button className="btn btn-secondary btn-sm">
              <FolderOpen size={14} /> Mở dự án
            </button>
            <input 
              type="file" 
              accept=".json" 
              className="file-upload-input" 
              onChange={handleLoadProject} 
            />
          </div>

          <button className="btn btn-primary btn-sm" onClick={handleRenderVideo}>
            <Sparkles size={14} /> Xuất MP4/WebM
          </button>
        </div>
      </header>

      {/* Main 3-Column Grid */}
      <div className="workspace-grid">
        
        {/* Left Column: Canvas Preview Player */}
        <section className="preview-panel">
          <div className="canvas-container">
            <canvas ref={canvasRef} width={720} height={1280} className="preview-canvas" />
          </div>

          <div className="player-controls">
            <div className="slider-container" style={{ padding: '0 0.2rem' }}>
              <input 
                type="range" 
                min={0} 
                max={duration} 
                step={0.05} 
                value={currentTime} 
                onChange={handleTimelineScrub} 
                className="timeline-slider"
              />
            </div>

            <div className="control-buttons" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}>
                <button className="play-pause-btn" onClick={handlePlayToggle} style={{ flexShrink: 0, width: '30px', height: '30px' }}>
                  {isPlaying ? <Pause size={14} fill="white" /> : <Play size={14} fill="white" style={{ marginLeft: '1px' }} />}
                </button>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
                </span>
              </div>

              <div className="volume-container" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                <Volume2 size={14} style={{ color: 'var(--text-secondary)' }} />
                <input 
                  type="range" 
                  min={0} 
                  max={1} 
                  step={0.05} 
                  value={volume} 
                  onChange={(e) => setVolume(parseFloat(e.target.value))} 
                  className="volume-slider" 
                  style={{ width: '60px', cursor: 'pointer' }}
                />
              </div>
            </div>

            <div style={{ fontSize: '0.65rem', color: '#888', marginTop: '0.5rem', textAlign: 'center', lineHeight: '1.4', borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '0.4rem' }}>
              💡 Mẹo: Nhấn <strong>Space</strong> để Chạy/Dừng. Nhấn phím <strong>[</strong> để gõ nhịp chuyển câu.
            </div>
          </div>

          {audioUrl && <audio ref={audioRef} src={audioUrl} style={{ display: 'none' }} />}

          {exportedVideoUrl && (
            <div className="glass-card" style={{ width: '100%', maxWidth: '290px', display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--accent-green)', fontWeight: 'bold' }}>✓ Dựng Video Thành Công!</span>
              <a 
                href={exportedVideoUrl} 
                download={`${customFilename || 'video_so_sanh'}.${exportedExt}`} 
                className="btn btn-primary btn-sm" 
                style={{ width: '100%' }}
              >
                <Download size={14} /> Tải Video Về Máy
              </a>
            </div>
          )}
        </section>

        {/* Middle Column: Multi-tab Settings (Comparisons, Timelines, TTS) */}
        <section className="editor-panel">
          <nav className="tabs-header">
            <button 
              className={`tab-btn ${activeTab === 'content' ? 'active' : ''}`} 
              onClick={() => setActiveTab('content')}
            >
              Nội dung so sánh
            </button>
            <button 
              className={`tab-btn ${activeTab === 'timeline' ? 'active' : ''}`} 
              onClick={() => setActiveTab('timeline')}
            >
              Pose & nhịp sub
            </button>
            <button 
              className={`tab-btn ${activeTab === 'tts' ? 'active' : ''}`} 
              onClick={() => setActiveTab('tts')}
            >
              Tạo Voice AI
            </button>
            <button 
              className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} 
              onClick={() => setActiveTab('settings')}
            >
              Cài đặt & Giao diện
            </button>
            <button 
              className={`tab-btn ${activeTab === 'publish' ? 'active' : ''}`} 
              onClick={() => setActiveTab('publish')}
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Share2 size={13} /> Đăng MXH & Hẹn giờ
            </button>
          </nav>

          {/* TAB 1: CONTENT & COMPARISONS */}
          {activeTab === 'content' && (
            <>
              {/* Dynamic Comparisons Stack */}
              <div className="glass-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h2 className="card-title" style={{ margin: 0 }}>Danh sách So Sánh</h2>
                  <button className="btn btn-secondary btn-sm" onClick={handleAddComparison}>
                    <PlusCircle size={14} /> Thêm So Sánh mới
                  </button>
                </div>

                <div className="comp-list">
                  {comparisons.map((comp, idx) => (
                    <div key={comp.id} className="comp-box">
                      <div className="comp-header">
                        <span className="comp-title">SO SÁNH CẶP {idx + 1}</span>
                        
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.25rem' }}>
                            <label style={{ fontSize: '0.65rem' }}>Bắt đầu từ câu</label>
                            <select 
                              value={comp.startIndex} 
                              onChange={(e) => handleUpdateComparison(comp.id, 'startIndex', parseInt(e.target.value, 10))}
                              style={{ padding: '0.2rem 0.35rem', fontSize: '0.75rem', height: '24px' }}
                            >
                              {timelineBlocks.map((b, bIdx) => (
                                <option key={b.id} value={bIdx}>Câu {bIdx + 1}: {b.text.substring(0, 15)}...</option>
                              ))}
                            </select>
                          </div>

                          <button className="btn btn-danger btn-sm" style={{ padding: '0.2rem', height: '24px' }} onClick={() => handleDeleteComparison(comp.id)}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>

                      <div className="form-grid">
                        {/* Left column config */}
                        <div style={{ borderRight: '1px solid rgba(255,255,255,0.05)', paddingRight: '0.5rem' }}>
                          <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                            <label style={{ color: '#aaa' }}>Tiêu đề Trái</label>
                            <input 
                              type="text" 
                              value={comp.leftTitle} 
                              onChange={(e) => handleUpdateComparison(comp.id, 'leftTitle', e.target.value)} 
                              style={{ padding: '0.35rem', fontSize: '0.8rem' }}
                            />
                          </div>

                          <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                            <label>Màu chữ</label>
                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                              <input 
                                type="text" 
                                value={comp.leftColor} 
                                onChange={(e) => handleUpdateComparison(comp.id, 'leftColor', e.target.value)}
                                style={{ padding: '0.35rem', fontSize: '0.8rem', flex: 1 }}
                              />
                              <input 
                                type="color" 
                                value={comp.leftColor} 
                                onChange={(e) => handleUpdateComparison(comp.id, 'leftColor', e.target.value)}
                                style={{ width: '28px', height: '28px', padding: 0 }}
                              />
                            </div>
                          </div>

                          <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                            <label>Ảnh bên Trái</label>
                            <FileUploadDropzone onChange={(e) => handleCompImageUpload(comp.id, 'left', e)}>
                              <div className="file-upload-btn" style={{ padding: '0.35rem' }}>
                                <Upload size={12} /> Chọn ảnh
                              </div>
                            </FileUploadDropzone>
                            {comp.leftImageUrl && <span className="file-upload-preview">✓ Đã tải</span>}
                          </div>


                        </div>

                        {/* Right column config */}
                        <div style={{ paddingLeft: '0.25rem' }}>
                          <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                            <label style={{ color: '#aaa' }}>Tiêu đề Phải</label>
                            <input 
                              type="text" 
                              value={comp.rightTitle} 
                              onChange={(e) => handleUpdateComparison(comp.id, 'rightTitle', e.target.value)} 
                              style={{ padding: '0.35rem', fontSize: '0.8rem' }}
                            />
                          </div>

                          <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                            <label>Màu chữ</label>
                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                              <input 
                                type="text" 
                                value={comp.rightColor} 
                                onChange={(e) => handleUpdateComparison(comp.id, 'rightColor', e.target.value)}
                                style={{ padding: '0.35rem', fontSize: '0.8rem', flex: 1 }}
                              />
                              <input 
                                type="color" 
                                value={comp.rightColor} 
                                onChange={(e) => handleUpdateComparison(comp.id, 'rightColor', e.target.value)}
                                style={{ width: '28px', height: '28px', padding: 0 }}
                              />
                            </div>
                          </div>

                          <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                            <label>Ảnh bên Phải</label>
                            <FileUploadDropzone onChange={(e) => handleCompImageUpload(comp.id, 'right', e)}>
                              <div className="file-upload-btn" style={{ padding: '0.35rem' }}>
                                <Upload size={12} /> Chọn ảnh
                              </div>
                            </FileUploadDropzone>
                            {comp.rightImageUrl && <span className="file-upload-preview">✓ Đã tải</span>}
                          </div>


                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* TAB 2: TIMELINE BEATS & MASCOT POSES */}
          {activeTab === 'timeline' && (
            <>
              {/* Mascot configuration details */}
              <div className="glass-card">
                <h2 className="card-title">Ảnh biểu cảm Mascot</h2>
                <div className="pose-grid">
                  <div className="pose-card">
                    <img src={mascotPoses.default} className="pose-avatar" alt="Default" />
                    <span className="pose-name">Đứng im</span>
                    <FileUploadDropzone onChange={(e) => handleMascotPoseUpload('default', e)} style={{ marginTop: '0.2rem' }}>
                      <button className="btn btn-secondary btn-sm" style={{ padding: '2px 4px', fontSize: '9px', width: '100%' }}>Sửa</button>
                    </FileUploadDropzone>
                  </div>

                  <div className="pose-card">
                    <img src={mascotPoses.point_left} className="pose-avatar" alt="Point Left" />
                    <span className="pose-name">Chỉ Trái</span>
                    <FileUploadDropzone onChange={(e) => handleMascotPoseUpload('point_left', e)} style={{ marginTop: '0.2rem' }}>
                      <button className="btn btn-secondary btn-sm" style={{ padding: '2px 4px', fontSize: '9px', width: '100%' }}>Sửa</button>
                    </FileUploadDropzone>
                  </div>

                  <div className="pose-card">
                    <img src={mascotPoses.point_right} className="pose-avatar" alt="Point Right" />
                    <span className="pose-name">Chỉ Phải</span>
                    <FileUploadDropzone onChange={(e) => handleMascotPoseUpload('point_right', e)} style={{ marginTop: '0.2rem' }}>
                      <button className="btn btn-secondary btn-sm" style={{ padding: '2px 4px', fontSize: '9px', width: '100%' }}>Sửa</button>
                    </FileUploadDropzone>
                  </div>

                  <div className="pose-card">
                    <img src={mascotPoses.shrug} className="pose-avatar" alt="Shrug" />
                    <span className="pose-name">Nhún vai</span>
                    <FileUploadDropzone onChange={(e) => handleMascotPoseUpload('shrug', e)} style={{ marginTop: '0.2rem' }}>
                      <button className="btn btn-secondary btn-sm" style={{ padding: '2px 4px', fontSize: '9px', width: '100%' }}>Sửa</button>
                    </FileUploadDropzone>
                  </div>
                </div>
              </div>

              {/* Timeline Block Beat rows */}
              <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h2 className="card-title" style={{ margin: 0 }}>Cấu hình nhịp phụ đề</h2>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {audioUrl && (
                      <button 
                        className="btn btn-secondary btn-sm" 
                        onClick={handleAutoSyncSilence} 
                        disabled={isProcessingAudio}
                        style={{ border: '1px solid var(--accent-indigo)', color: 'var(--accent-indigo)' }}
                      >
                        {isProcessingAudio ? 'Đang phân tích...' : 'Tự động khớp nhịp (Silence Sync)'}
                      </button>
                    )}
                    <button className="btn btn-secondary btn-sm" onClick={handleAddTimelineBlock}>
                      <Plus size={12} /> Thêm câu
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '75px 75px 1fr 115px 105px 35px', gap: '0.5rem', padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--border-light)', fontSize: '0.7rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                  <div>BẮT ĐẦU</div>
                  <div>KẾT THÚC</div>
                  <div>TEXT PHỤ ĐỀ</div>
                  <div>BIỂU CẢM MASCOT</div>
                  <div>HIGHLIGHT</div>
                  <div>XÓA</div>
                </div>

                <div className="timeline-list">
                  {timelineBlocks.map((block, index) => {
                    const isActive = currentTime >= block.start && currentTime <= block.end;
                    return (
                      <div key={block.id} className={`timeline-item ${isActive ? 'active' : ''}`}>
                        <div>
                          <input 
                            type="number" 
                            step="0.1" 
                            value={block.start} 
                            onChange={(e) => handleUpdateTimelineBlock(block.id, 'start', e.target.value)} 
                            className="timeline-time-input" 
                          />
                        </div>
                        <div>
                          <input 
                            type="number" 
                            step="0.1" 
                            value={block.end} 
                            onChange={(e) => handleUpdateTimelineBlock(block.id, 'end', e.target.value)} 
                            className="timeline-time-input" 
                          />
                        </div>
                        <div>
                          <input 
                            type="text" 
                            value={block.text} 
                            onChange={(e) => handleUpdateTimelineBlock(block.id, 'text', e.target.value)} 
                            className="timeline-text-input" 
                          />
                        </div>
                        <div>
                          <select 
                            value={block.pose} 
                            onChange={(e) => handleUpdateTimelineBlock(block.id, 'pose', e.target.value)} 
                            className="timeline-select"
                          >
                            <option value="default">Đứng im</option>
                            <option value="point_left">Chỉ Trái (A)</option>
                            <option value="point_right">Chỉ Phải (B)</option>
                            <option value="shrug">Nhún vai (?)</option>
                          </select>
                        </div>
                        <div>
                          <select 
                            value={block.highlight} 
                            onChange={(e) => handleUpdateTimelineBlock(block.id, 'highlight', e.target.value)} 
                            className="timeline-select"
                          >
                            <option value="none">Không sáng</option>
                            <option value="left">Trái sáng</option>
                            <option value="right">Phải sáng</option>
                          </select>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <button className="btn btn-danger btn-sm" style={{ padding: '0.2rem' }} onClick={() => handleDeleteTimelineBlock(block.id)}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* TAB 3: TTS VOICE MAKER (Tabbed: ElevenLabs vs VClip) */}
          {activeTab === 'tts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Sub-tab selection */}
              <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255, 255, 255, 0.05)', padding: '0.25rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <button 
                  className={`tab-btn ${ttsProvider === 'elevenlabs' ? 'active' : ''}`}
                  onClick={() => handleSelectTtsProvider('elevenlabs')}
                  style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem', borderRadius: '6px', cursor: 'pointer', border: 'none', background: ttsProvider === 'elevenlabs' ? 'var(--accent-indigo)' : 'none', color: 'white', fontWeight: 'bold' }}
                >
                  ElevenLabs
                </button>
                <button 
                  className={`tab-btn ${ttsProvider === 'vclip' ? 'active' : ''}`}
                  onClick={() => handleSelectTtsProvider('vclip')}
                  style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem', borderRadius: '6px', cursor: 'pointer', border: 'none', background: ttsProvider === 'vclip' ? 'var(--accent-indigo)' : 'none', color: 'white', fontWeight: 'bold' }}
                >
                  VClip TTS
                </button>
                <button 
                  className={`tab-btn ${ttsProvider === 'lucylab' ? 'active' : ''}`}
                  onClick={() => handleSelectTtsProvider('lucylab')}
                  style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem', borderRadius: '6px', cursor: 'pointer', border: 'none', background: ttsProvider === 'lucylab' ? 'var(--accent-indigo)' : 'none', color: 'white', fontWeight: 'bold' }}
                >
                  LucyLab TTS
                </button>
              </div>

              {/* 1. ElevenLabs UI */}
              {ttsProvider === 'elevenlabs' && (
                <div className="glass-card" style={{ marginTop: 0 }}>
                  <h2 className="card-title">Trình tạo giọng nói ElevenLabs</h2>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div className="form-group">
                      <label>ElevenLabs API Key</label>
                      <div className="tts-input-row">
                        <ApiKeyInput 
                          value={elevenLabsApiKey} 
                          onChange={(e) => handleSaveApiKey(e.target.value)}
                          placeholder="Nhập xi-api-key từ Website Reset hoặc elevenlabs.io" 
                        />
                        <button className="btn btn-secondary btn-sm" onClick={() => fetchVoices(elevenLabsApiKey)}>
                          Tải giọng đọc
                        </button>
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Chọn Giọng Đọc (Voice)</label>
                      <select 
                        value={selectedVoiceId} 
                        onChange={(e) => setSelectedVoiceId(e.target.value)}
                        disabled={voices.length === 0}
                      >
                        {voices.length === 0 ? (
                          <option value="">-- Chưa tải danh sách giọng đọc --</option>
                        ) : (
                          voices.map(v => (
                            <option key={v.voice_id} value={v.voice_id}>{v.name} ({v.category || 'Mặc định'})</option>
                          ))
                        )}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Chọn Mô hình (Model)</label>
                      <select 
                        value={selectedModelId} 
                        onChange={(e) => setSelectedModelId(e.target.value)}
                      >
                        <option value="eleven_v3">Eleven v3 (Mới nhất - Biểu cảm cao & Cực kỳ chuẩn tiếng Việt)</option>
                        <option value="eleven_turbo_v2_5">Turbo v2.5 (Tốc độ nhanh, phát âm chuẩn)</option>
                        <option value="eleven_multilingual_v2">Multilingual v2 (Đọc diễn cảm, đa ngôn ngữ)</option>
                      </select>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', padding: '0.75rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.75rem' }}>Độ ổn định (Stability: {stability * 100}%)</label>
                        <input 
                          type="range" 
                          min="0" 
                          max="1" 
                          step="0.05" 
                          value={stability} 
                          onChange={(e) => setStability(parseFloat(e.target.value))} 
                        />
                        <span style={{ fontSize: '0.65rem', color: '#888' }}>Thấp = diễn cảm hơn | Cao = đều giọng</span>
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.75rem' }}>Độ giống giọng gốc ({similarityBoost * 100}%)</label>
                        <input 
                          type="range" 
                          min="0" 
                          max="1" 
                          step="0.05" 
                          value={similarityBoost} 
                          onChange={(e) => setSimilarityBoost(parseFloat(e.target.value))} 
                        />
                        <span style={{ fontSize: '0.65rem', color: '#888' }}>Cao = cực kỳ giống | Thấp = tự nhiên hơn</span>
                      </div>

                      <div className="form-group" style={{ margin: 0, marginTop: '0.5rem' }}>
                        <label style={{ fontSize: '0.75rem' }}>Độ cường điệu (Style: {styleExaggeration * 100}%)</label>
                        <input 
                          type="range" 
                          min="0" 
                          max="1" 
                          step="0.05" 
                          value={styleExaggeration} 
                          onChange={(e) => setStyleExaggeration(parseFloat(e.target.value))} 
                        />
                        <span style={{ fontSize: '0.65rem', color: '#888' }}>Độ cường điệu hóa phong cách nói</span>
                      </div>

                      <div className="form-group" style={{ margin: 0, marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', height: '100%' }}>
                        <input 
                          type="checkbox" 
                          id="speaker_boost_chk"
                          checked={useSpeakerBoost} 
                          onChange={(e) => setUseSpeakerBoost(e.target.checked)} 
                          style={{ width: '16px', height: '16px', cursor: 'pointer', margin: 0 }}
                        />
                        <label htmlFor="speaker_boost_chk" style={{ fontSize: '0.75rem', cursor: 'pointer', userSelect: 'none', margin: 0 }}>Tăng cường giọng đọc (Speaker Boost)</label>
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Xem trước Kịch bản gửi đi</label>
                      <textarea 
                        value={timelineBlocks.map(b => b.text).join('\n\n')}
                        readOnly
                        rows={8}
                        style={{ background: '#0b0f19', color: '#94a3b8', fontStyle: 'italic', fontSize: '0.8rem', resize: 'none' }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <button 
                        className="btn btn-primary" 
                        onClick={handleGenerateVoice} 
                        disabled={isGeneratingVoice || isProcessingAudio || !elevenLabsApiKey || voices.length === 0}
                        style={{ width: '100%', padding: '0.75rem' }}
                      >
                        {isGeneratingVoice ? (
                          <>
                            <span className="spinner" style={{ marginRight: '0.5rem' }}></span> Đang sinh giọng đọc AI...
                          </>
                        ) : isProcessingAudio ? (
                          <>
                            <span className="spinner" style={{ marginRight: '0.5rem' }}></span> Đang phân tích khoảng lặng khớp nhịp...
                          </>
                        ) : (
                          <>
                            <Sparkles size={16} /> Sinh giọng đọc & Tự động khớp nhịp
                          </>
                        )}
                      </button>

                      {audioUrl && (
                        <button 
                          className="btn btn-secondary" 
                          onClick={handleAutoSyncSilence}
                          disabled={isGeneratingVoice || isProcessingAudio}
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--accent-indigo)', color: 'var(--accent-indigo)' }}
                        >
                          {isProcessingAudio ? 'Đang phân tích...' : 'Chạy lại Tự động khớp nhịp (Silence Sync)'}
                        </button>
                      )}
                    </div>

                    <div style={{ fontSize: '0.7rem', color: '#a0aec0', marginTop: '0.2rem', fontStyle: 'italic', textAlign: 'center' }}>
                      * Sau khi tạo giọng đọc xong, hệ thống tự động quét dữ liệu PCM để căn khớp phụ đề chuẩn theo khoảng nghỉ nói của AI.
                    </div>

                    {/* Section Voice Cloning */}
                    <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px dashed rgba(255, 255, 255, 0.15)' }}>
                      <h3 style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--accent-indigo)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Sparkles size={14} /> Clone Giọng nói Tức thì (Instant Voice Cloning)
                      </h3>
                      <p style={{ fontSize: '0.7rem', color: '#a0aec0', marginBottom: '0.75rem', lineHeight: '1.4' }}>
                        Tải lên file âm thanh mẫu (.mp3 hoặc .wav) dài từ 10s đến 1 phút của giọng bạn muốn clone để tạo một giọng nói mới trên tài khoản ElevenLabs của bạn.
                      </p>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.75rem', background: 'rgba(99, 102, 241, 0.05)', borderRadius: '8px', border: '1px dashed rgba(99, 102, 241, 0.2)' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label style={{ fontSize: '0.75rem', color: '#ccc' }}>Tên giọng nói Clone</label>
                          <input 
                            type="text" 
                            value={cloneVoiceName} 
                            onChange={(e) => setCloneVoiceName(e.target.value)}
                            placeholder="Ví dụ: Giọng MC Nam Việt Nam"
                            style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
                          />
                        </div>

                        <div className="form-group" style={{ margin: 0 }}>
                          <label style={{ fontSize: '0.75rem', color: '#ccc' }}>Tải lên File Âm thanh Mẫu</label>
                          <div className="file-upload-wrapper">
                            <FileUploadDropzone 
                              accept="audio/mp3,audio/wav,audio/mpeg,audio/x-wav" 
                              onChange={(e) => setCloneSampleFile(e.target.files[0])}
                            >
                              <div className="file-upload-btn" style={{ padding: '0.4rem', fontSize: '0.8rem' }}>
                                <Upload size={12} /> {cloneSampleFile ? 'Đã chọn file' : 'Chọn file âm thanh mẫu (.mp3/.wav)'}
                              </div>
                            </FileUploadDropzone>
                          </div>
                          {cloneSampleFile && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--accent-green)', marginTop: '0.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span>✓ {cloneSampleFile.name} ({(cloneSampleFile.size / 1024 / 1024).toFixed(2)} MB)</span>
                              <button 
                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.7rem' }}
                                onClick={() => setCloneSampleFile(null)}
                              >
                                Hủy chọn
                              </button>
                            </div>
                          )}
                        </div>

                        <button 
                          className="btn btn-secondary" 
                          onClick={handleCloneVoice}
                          disabled={isCloningVoice || !elevenLabsApiKey || !cloneVoiceName || !cloneSampleFile}
                          style={{ padding: '0.6rem', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', background: 'var(--accent-indigo)', color: 'white', border: 'none' }}
                        >
                          {isCloningVoice ? (
                            <>
                              <span className="spinner" style={{ marginRight: '0.25rem' }}></span> Đang tiến hành Clone giọng nói...
                            </>
                          ) : (
                            <>
                              <Plus size={14} /> Bắt đầu Clone Giọng nói
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 2. VClip UI */}
              {ttsProvider === 'vclip' && (
                <div className="glass-card" style={{ marginTop: 0 }}>
                  <h2 className="card-title">Trình tạo giọng nói VClip TTS</h2>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div className="form-group">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                        <label style={{ margin: 0 }}>VClip API Key</label>
                        <button 
                          type="button" 
                          className="btn btn-secondary btn-sm"
                          onClick={() => setShowVclipKeyModal(true)}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', padding: '0.25rem 0.55rem', background: 'rgba(99, 102, 241, 0.15)', border: '1px solid var(--accent-indigo)', color: '#818cf8', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                        >
                          <Key size={13} /> Danh sách Key ({activeUsableKeyCount}/{vclipKeyItems.length})
                        </button>
                      </div>
                      <ApiKeyInput 
                        value={vclipApiKey} 
                        onChange={(e) => handleSaveVclipApiKey(e.target.value)}
                        placeholder="Nhập API Key VClip (sk_live_...)" 
                      />
                      {vclipKeyItems.length > 0 && (
                        <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '0.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>🔑 Đang dùng: <code style={{ color: '#38bdf8', fontFamily: 'monospace' }}>{vclipApiKey ? `${vclipApiKey.substring(0, 10)}...${vclipApiKey.slice(-4)}` : 'Chưa chọn'}</code></span>
                          <span style={{ color: activeUsableKeyCount > 0 ? '#10b981' : '#f43f5e', fontWeight: 'bold' }}>
                            {activeUsableKeyCount > 0 ? `🟢 Còn ${activeUsableKeyCount} Key khả dụng` : '⚠️ Hết Key khả dụng'}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="form-group">
                      <label>ID Giọng nói VClip (userVoiceId)</label>
                      <input 
                        type="text" 
                        value={vclipVoiceId} 
                        onChange={(e) => handleSaveVclipVoiceId(e.target.value)}
                        placeholder="Nhập ID giọng đọc tự tạo lấy từ vclip.io" 
                        style={{ padding: '0.5rem', fontSize: '0.8rem' }}
                      />
                    </div>

                    <div className="form-group">
                      <label>Tốc độ đọc VClip ({vclipSpeed}x)</label>
                      <input 
                        type="range" 
                        min="0.5" 
                        max="2.0" 
                        step="0.1" 
                        value={vclipSpeed} 
                        onChange={(e) => setVclipSpeed(parseFloat(e.target.value))} 
                      />
                      <span style={{ fontSize: '0.65rem', color: '#888' }}>Mặc định là 1.0 (Phạm vi từ 0.5 - 2.0)</span>
                    </div>

                    <div className="form-group">
                      <label>Xem trước Kịch bản thoại gửi đi</label>
                      <textarea 
                        value={timelineBlocks.map(b => b.text).join('\n\n')}
                        readOnly
                        rows={8}
                        style={{ background: '#0b0f19', color: '#94a3b8', fontStyle: 'italic', fontSize: '0.8rem', resize: 'none' }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <button 
                        className="btn btn-primary" 
                        onClick={handleGenerateVoiceVClip} 
                        disabled={isGeneratingVoice || isProcessingAudio || !vclipApiKey || !vclipVoiceId}
                        style={{ width: '100%', padding: '0.75rem' }}
                      >
                        {isGeneratingVoice ? (
                          <>
                            <span className="spinner" style={{ marginRight: '0.5rem' }}></span> Đang gọi API tạo giọng nói...
                          </>
                        ) : isProcessingAudio ? (
                          <>
                            <span className="spinner" style={{ marginRight: '0.5rem' }}></span> Đang phân tích khoảng lặng khớp nhịp...
                          </>
                        ) : (
                          <>
                            <Sparkles size={16} /> Sinh giọng đọc & Tự động khớp nhịp
                          </>
                        )}
                      </button>

                      {audioUrl && (
                        <button 
                          className="btn btn-secondary" 
                          onClick={handleAutoSyncSilence}
                          disabled={isGeneratingVoice || isProcessingAudio}
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--accent-indigo)', color: 'var(--accent-indigo)' }}
                        >
                          {isProcessingAudio ? 'Đang phân tích...' : 'Chạy lại Tự động khớp nhịp (Silence Sync)'}
                        </button>
                      )}
                    </div>

                    <div style={{ fontSize: '0.7rem', color: '#a0aec0', marginTop: '0.2rem', fontStyle: 'italic', textAlign: 'center', lineHeight: '1.4' }}>
                      * Khi bấm Sinh giọng, tool sẽ gửi kịch bản thoại lên API VClip, tiến hành Polling chờ xuất file hoàn tất, tự động tải xuống và căn khớp nhịp phụ đề dựa trên khoảng lặng giọng nói.
                    </div>
                  </div>
                </div>
              )}

              {/* 3. LucyLab UI */}
              {ttsProvider === 'lucylab' && (
                <div className="glass-card" style={{ marginTop: 0 }}>
                  <h2 className="card-title">Trình tạo giọng nói LucyLab (LucyAI / ViVibe)</h2>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div className="form-group">
                      <label>LucyLab API Key</label>
                      <div className="tts-input-row">
                        <ApiKeyInput 
                          value={lucyLabApiKey} 
                          onChange={(e) => handleSaveLucyLabApiKey(e.target.value)}
                          placeholder="Nhập API Key LucyLab (sk_live_...)" 
                        />
                        <button className="btn btn-secondary btn-sm" onClick={() => fetchLucyLabVoices(lucyLabApiKey)} disabled={isLoadingLucyLabVoices}>
                          {isLoadingLucyLabVoices ? 'Đang tải...' : 'Tải giọng đọc'}
                        </button>
                      </div>
                    </div>

                    {lucyLabVoices.length > 0 && (
                      <div className="form-group">
                        <label>Chọn Giọng đọc trong Tài khoản</label>
                        <select 
                          value={lucyLabVoiceId} 
                          onChange={(e) => handleSaveLucyLabVoiceId(e.target.value)}
                          style={{ padding: '0.5rem', fontSize: '0.8rem' }}
                        >
                          {lucyLabVoices.map(v => (
                            <option key={v.id} value={v.id}>{v.name || v.id} {v.isActive ? '(Active)' : ''}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="form-group">
                      <label>ID Giọng nói LucyLab (userVoiceId)</label>
                      <input 
                        type="text" 
                        value={lucyLabVoiceId} 
                        onChange={(e) => handleSaveLucyLabVoiceId(e.target.value)}
                        placeholder="Nhập ID giọng đọc từ vivibe.app / lucylab.io" 
                        style={{ padding: '0.5rem', fontSize: '0.8rem' }}
                      />
                    </div>

                    <div className="form-group">
                      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Tốc độ đọc LucyLab</span>
                        <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{lucyLabSpeed}x</span>
                      </label>
                      <input 
                        type="range" 
                        min="0.5" 
                        max="1.5" 
                        step="0.05" 
                        value={lucyLabSpeed} 
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setLucyLabSpeed(val);
                          localStorage.setItem('lucyLabSpeed', val.toString());
                        }} 
                        style={{ cursor: 'pointer', height: '6px' }}
                      />
                      <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.4rem' }}>
                        {[
                          { label: '🐢 0.8x (Chậm)', val: 0.8 },
                          { label: '✨ 0.85x (Khuyên dùng)', val: 0.85 },
                          { label: '🎙️ 0.9x (Vừa)', val: 0.9 },
                          { label: '⚡ 1.0x (Gốc)', val: 1.0 }
                        ].map(p => (
                          <button 
                            key={p.val}
                            type="button"
                            onClick={() => {
                              setLucyLabSpeed(p.val);
                              localStorage.setItem('lucyLabSpeed', p.val.toString());
                            }}
                            style={{
                              flex: 1,
                              padding: '0.35rem 0.2rem',
                              fontSize: '0.65rem',
                              borderRadius: '4px',
                              border: lucyLabSpeed === p.val ? '1px solid var(--accent-indigo)' : '1px solid rgba(255,255,255,0.1)',
                              background: lucyLabSpeed === p.val ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.03)',
                              color: lucyLabSpeed === p.val ? '#fff' : '#aaa',
                              cursor: 'pointer'
                            }}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Xem trước Kịch bản thoại gửi đi</label>
                      <textarea 
                        value={timelineBlocks.map(b => b.text).join('\n\n')}
                        readOnly
                        rows={8}
                        style={{ background: '#0b0f19', color: '#94a3b8', fontStyle: 'italic', fontSize: '0.8rem', resize: 'none' }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <button 
                        className="btn btn-primary" 
                        onClick={handleGenerateVoiceLucyLab} 
                        disabled={isGeneratingVoice || isProcessingAudio || !lucyLabApiKey || !lucyLabVoiceId}
                        style={{ width: '100%', padding: '0.75rem' }}
                      >
                        {isGeneratingVoice ? (
                          <>
                            <span className="spinner" style={{ marginRight: '0.5rem' }}></span> Đang gọi API LucyLab tạo giọng...
                          </>
                        ) : isProcessingAudio ? (
                          <>
                            <span className="spinner" style={{ marginRight: '0.5rem' }}></span> Đang phân tích khoảng lặng khớp nhịp...
                          </>
                        ) : (
                          <>
                            <Sparkles size={16} /> Sinh giọng đọc LucyLab & Tự động khớp nhịp
                          </>
                        )}
                      </button>

                      {audioUrl && (
                        <button 
                          className="btn btn-secondary" 
                          onClick={handleAutoSyncSilence}
                          disabled={isGeneratingVoice || isProcessingAudio}
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--accent-indigo)', color: 'var(--accent-indigo)' }}
                        >
                          {isProcessingAudio ? 'Đang phân tích...' : 'Chạy lại Tự động khớp nhịp (Silence Sync)'}
                        </button>
                      )}
                    </div>

                    <div style={{ fontSize: '0.7rem', color: '#a0aec0', marginTop: '0.2rem', fontStyle: 'italic', textAlign: 'center', lineHeight: '1.4' }}>
                      * Khi bấm Sinh giọng, hệ thống gửi kịch bản thoại tới API LucyLab (json-rpc), tự động Polling chờ ghép audio hoàn tất và căn khớp nhịp phụ đề dựa trên khoảng nghỉ giọng đọc.
                    </div>
                  </div>
                </div>
              )}

              {/* Cấu hình đồng bộ nhịp phụ đề (Silence Sync) */}
              {audioUrl && (
                <div className="glass-card" style={{ marginTop: 0 }}>
                  <h3 style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--accent-indigo)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Sliders size={14} /> Cấu hình đồng bộ nhịp phụ đề (Silence Sync)
                  </h3>
                  <p style={{ fontSize: '0.7rem', color: '#a0aec0', marginBottom: '0.75rem', lineHeight: '1.4' }}>
                    Nếu phụ đề chạy lệch nhịp so với giọng nói (đặc biệt là giọng đọc nhanh), hãy điều chỉnh hai thông số bên dưới rồi bấm nút <strong>Cập nhật lại nhịp</strong> để căn chỉnh lại ngay lập tức mà không cần tạo lại giọng đọc.
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', padding: '0.75rem', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)', marginBottom: '0.75rem' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: '0.75rem', color: '#ccc', display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <span>Ngưỡng khoảng lặng (Threshold)</span>
                        <span style={{ color: 'var(--accent-indigo)', fontWeight: 'bold' }}>{silenceThreshold}</span>
                      </label>
                      <input 
                        type="range" 
                        min="0.001" 
                        max="0.05" 
                        step="0.001" 
                        value={silenceThreshold} 
                        onChange={(e) => setSilenceThreshold(parseFloat(e.target.value))} 
                        style={{ height: '6px', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.6rem', color: '#777', marginTop: '0.2rem', display: 'block' }}>Tăng nếu giọng nói đọc nhanh/nhỏ; giảm nếu bị nhiễu âm.</span>
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: '0.75rem', color: '#ccc', display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <span>Độ dài nghỉ tối thiểu</span>
                        <span style={{ color: 'var(--accent-indigo)', fontWeight: 'bold' }}>{minSilenceDuration}s</span>
                      </label>
                      <input 
                        type="range" 
                        min="0.05" 
                        max="1.0" 
                        step="0.05" 
                        value={minSilenceDuration} 
                        onChange={(e) => setMinSilenceDuration(parseFloat(e.target.value))} 
                        style={{ height: '6px', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.6rem', color: '#777', marginTop: '0.2rem', display: 'block' }}>Giảm (e.g. 0.08s - 0.15s) nếu người đọc nói nhanh, nuốt chữ.</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.75rem' }}>
                    <label style={{ fontSize: '0.75rem', color: '#ccc' }}>Thuật toán căn khớp phụ đề</label>
                    <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255, 255, 255, 0.03)', padding: '0.2rem', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                      <button 
                        type="button"
                        onClick={() => { setSilenceSyncMode('simple'); localStorage.setItem('silenceSyncMode', 'simple'); }}
                        style={{ flex: 1, padding: '0.35rem', fontSize: '0.7rem', borderRadius: '4px', cursor: 'pointer', border: 'none', background: silenceSyncMode === 'simple' ? 'var(--accent-indigo)' : 'none', color: '#fff', fontWeight: 'bold' }}
                      >
                        Tuần tự đơn giản (Khuyên dùng VClip/ElevenLabs)
                      </button>
                      <button 
                        type="button"
                        onClick={() => { setSilenceSyncMode('dp'); localStorage.setItem('silenceSyncMode', 'dp'); }}
                        style={{ flex: 1, padding: '0.35rem', fontSize: '0.7rem', borderRadius: '4px', cursor: 'pointer', border: 'none', background: silenceSyncMode === 'dp' ? 'var(--accent-indigo)' : 'none', color: '#fff', fontWeight: 'bold' }}
                      >
                        Quy hoạch động DP (Khuyên dùng LucyLab)
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#cbd5e1', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.15)', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                    <span>
                      Trạng thái phát hiện: <strong style={{ color: 'var(--accent-green)' }}>{detectedSilencesCount !== null ? `${detectedSilencesCount} khoảng nghỉ` : 'Chưa phân tích'}</strong>
                    </span>
                    <button 
                      className="btn btn-primary btn-sm" 
                      onClick={() => runSilenceSyncWithUrl(audioUrl, duration)}
                    >
                      Khớp nhịp ngay
                    </button>
                  </div>

                  <div className="form-group">
                    <label>Logo kênh (Upload)</label>
                    <FileUploadDropzone accept="image/*" onChange={handleLogoUpload}>
                      <div className="file-upload-btn">
                        <Upload size={14} /> Tải logo
                      </div>
                    </FileUploadDropzone>
                    {logoFileName && <span className="file-upload-preview">✓ {logoFileName}</span>}
                  </div>

                  <div className="form-group">
                    <label>Hoặc Upload Audio sẵn có</label>
                    <FileUploadDropzone accept="audio/*,video/mp4" onChange={handleAudioUpload}>
                      <div className="file-upload-btn">
                        <Upload size={14} /> Audio/MP4 VO
                      </div>
                    </FileUploadDropzone>
                    {audioFileName && <span className="file-upload-preview">✓ {audioFileName}</span>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: SETTINGS & SUBTITLES */}
          {activeTab === 'settings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Channel Presets Manager */}
              <div className="glass-card" style={{ borderLeft: '4px solid var(--accent-indigo)', background: 'linear-gradient(135deg, rgba(30,27,75,0.4) 0%, rgba(15,23,42,0.6) 100%)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h2 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-indigo)' }}>
                    <Sparkles size={18} /> Bộ Quản Lý Mẫu Kênh (Channel Presets)
                  </h2>
                  <button 
                    type="button" 
                    className="btn btn-primary btn-sm"
                    onClick={handleSaveNewChannelProfile}
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                  >
                    ➕ Tạo Kênh Mới
                  </button>
                </div>
                <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.75rem', lineHeight: '1.4' }}>
                  Chuyển đổi 1-Click toàn bộ <strong>Tiêu đề, Avatar, Mascot & Theme màu sắc</strong> giữa các kênh khác nhau (ví dụ: Mèo Thông Thái, Ngựa Biết Tuốt, Hổ Siberia,...). Tái sử dụng 100% codebase chung cho mọi kênh của bạn!
                </p>

                {/* Preset List Chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  {channelProfiles.map(p => {
                    const isActive = p.id === activeChannelId;
                    return (
                      <div 
                        key={p.id}
                        onClick={() => handleApplyChannelProfile(p)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          padding: '0.5rem 0.85rem',
                          borderRadius: '8px',
                          border: isActive ? '2px solid var(--accent-indigo)' : '1px solid rgba(255, 255, 255, 0.12)',
                          background: isActive ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                          color: isActive ? '#FFFFFF' : '#CBD5E1',
                          cursor: 'pointer',
                          fontWeight: isActive ? 'bold' : 'normal',
                          fontSize: '0.8rem',
                          transition: 'all 0.15s ease',
                          boxShadow: isActive ? '0 0 12px rgba(99, 102, 241, 0.35)' : 'none'
                        }}
                      >
                        <span>{p.name}</span>
                        {isActive && <span style={{ fontSize: '0.65rem', background: 'var(--accent-indigo)', color: '#fff', padding: '0.1rem 0.35rem', borderRadius: '4px', marginLeft: '0.2rem' }}>Đang dùng</span>}
                      </div>
                    );
                  })}
                </div>

                {/* Channel Actions Footer */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.5rem', borderTop: '1px dashed rgba(255,255,255,0.1)', fontSize: '0.75rem' }}>
                  <button 
                    type="button" 
                    className="btn btn-secondary btn-sm"
                    onClick={handleUpdateCurrentChannelProfile}
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
                  >
                    💾 Lưu thay đổi thiết lập vào Kênh hiện tại
                  </button>

                  {channelProfiles.length > 1 && (
                    <button 
                      type="button" 
                      onClick={() => handleDeleteChannelProfile(activeChannelId)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline' }}
                    >
                      Xóa mẫu kênh này
                    </button>
                  )}
                </div>
              </div>

              {/* General header config */}
              <div className="glass-card">
                <h2 className="card-title">Cấu hình chung Video</h2>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Tiêu đề kênh</label>
                    <input 
                      type="text" 
                      value={headerTitle} 
                      onChange={(e) => updateHeaderTitle(e.target.value)} 
                    />
                  </div>

                  <div className="form-group">
                    <label>Tên tệp tin khi xuất (Không dấu & cách)</label>
                    <input 
                      type="text" 
                      value={customFilename} 
                      onChange={(e) => setCustomFilename(e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, ''))} 
                      placeholder="so_sanh_meo_thong_thai"
                    />
                  </div>

                  <div className="form-group">
                    <label>Màu nền Video</label>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <input 
                        type="text" 
                        value={bgColor} 
                        onChange={(e) => updateBgColor(e.target.value)} 
                        style={{ flex: 1 }}
                      />
                      <input 
                        type="color" 
                        value={bgColor.startsWith('#') ? bgColor : '#FAF6F0'} 
                        onChange={(e) => updateBgColor(e.target.value)} 
                        style={{ width: '32px', height: '32px', padding: 0, cursor: 'pointer' }}
                      />
                    </div>
                  </div>

                  {/* Bộ chọn Theme Nhanh cho Video (Quick Theme Presets) */}
                  <div className="form-group" style={{ padding: '0.75rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--accent-indigo)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem' }}>
                      <Palette size={16} /> Chọn Theme Nhanh cho Video (Quick Theme Presets)
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                      <button 
                        type="button"
                        className="btn"
                        onClick={() => applyThemePreset('light')}
                        style={{
                          padding: '0.5rem 0.6rem',
                          borderRadius: '8px',
                          border: bgColor === '#FAF6F0' ? '2px solid var(--accent-indigo)' : '1px solid rgba(255, 255, 255, 0.12)',
                          background: '#FAF6F0',
                          color: '#1e293b',
                          fontWeight: 'bold',
                          fontSize: '0.75rem',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          boxShadow: bgColor === '#FAF6F0' ? '0 0 10px rgba(99, 102, 241, 0.4)' : 'none'
                        }}
                      >
                        <span style={{ fontSize: '0.9rem' }}>☀️</span> Theme Sáng Trắng Kem
                      </button>

                      <button 
                        type="button"
                        className="btn"
                        onClick={() => applyThemePreset('dark-contrast')}
                        style={{
                          padding: '0.5rem 0.6rem',
                          borderRadius: '8px',
                          border: bgColor === '#0B0F19' ? '2px solid var(--accent-indigo)' : '1px solid rgba(255, 255, 255, 0.12)',
                          background: '#0B0F19',
                          color: '#38BDF8',
                          fontWeight: 'bold',
                          fontSize: '0.75rem',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          boxShadow: bgColor === '#0B0F19' ? '0 0 10px rgba(56, 189, 248, 0.4)' : 'none'
                        }}
                      >
                        <span style={{ fontSize: '0.9rem' }}>🌙</span> Theme Tối High-Contrast
                      </button>

                      <button 
                        type="button"
                        className="btn"
                        onClick={() => applyThemePreset('dark-neon')}
                        style={{
                          padding: '0.5rem 0.6rem',
                          borderRadius: '8px',
                          border: bgColor === '#070614' ? '2px solid var(--accent-indigo)' : '1px solid rgba(255, 255, 255, 0.12)',
                          background: '#070614',
                          color: '#00FFCC',
                          fontWeight: 'bold',
                          fontSize: '0.75rem',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          boxShadow: bgColor === '#070614' ? '0 0 10px rgba(0, 255, 204, 0.4)' : 'none'
                        }}
                      >
                        <span style={{ fontSize: '0.9rem' }}>⚡</span> Theme Tối Neon Cyber
                      </button>

                      <button 
                        type="button"
                        className="btn"
                        onClick={() => applyThemePreset('dark-gold')}
                        style={{
                          padding: '0.5rem 0.6rem',
                          borderRadius: '8px',
                          border: bgColor === '#121212' ? '2px solid var(--accent-indigo)' : '1px solid rgba(255, 255, 255, 0.12)',
                          background: '#121212',
                          color: '#FBBF24',
                          fontWeight: 'bold',
                          fontSize: '0.75rem',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          boxShadow: bgColor === '#121212' ? '0 0 10px rgba(251, 191, 36, 0.4)' : 'none'
                        }}
                      >
                        <span style={{ fontSize: '0.9rem' }}>👑</span> Theme Tối Hoàng Gia Gold
                      </button>

                      <button 
                        type="button"
                        className="btn"
                        onClick={() => applyThemePreset('dark-gradient')}
                        style={{
                          gridColumn: 'span 2',
                          padding: '0.5rem 0.6rem',
                          borderRadius: '8px',
                          border: bgColor.startsWith('linear-gradient') ? '2px solid var(--accent-indigo)' : '1px solid rgba(255, 255, 255, 0.12)',
                          background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #311042 100%)',
                          color: '#F43F5E',
                          fontWeight: 'bold',
                          fontSize: '0.75rem',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          boxShadow: bgColor.startsWith('linear-gradient') ? '0 0 10px rgba(244, 63, 94, 0.4)' : 'none'
                        }}
                      >
                        <span style={{ fontSize: '0.9rem' }}>🌌</span> Theme Gradient Biển Đêm Sang Trọng
                      </button>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Logo kênh (Upload)</label>
                    <FileUploadDropzone accept="image/*" onChange={handleLogoUpload}>
                      <div className="file-upload-btn">
                        <Upload size={14} /> Tải logo
                      </div>
                    </FileUploadDropzone>
                    {logoFileName && <span className="file-upload-preview">✓ {logoFileName}</span>}
                  </div>

                  <div className="form-group">
                    <label>Hoặc Upload Audio sẵn có</label>
                    <FileUploadDropzone accept="audio/*,video/mp4" onChange={handleAudioUpload}>
                      <div className="file-upload-btn">
                        <Upload size={14} /> Audio/MP4 VO
                      </div>
                    </FileUploadDropzone>
                    {audioFileName && <span className="file-upload-preview">✓ {audioFileName}</span>}
                  </div>

                  <div className="form-group">
                    <label>Vị trí Logo & Tiêu đề kênh</label>
                    <select 
                      value={headerPosition} 
                      onChange={(e) => updateHeaderPosition(e.target.value)}
                    >
                      <option value="top-center">Giữa trên cùng (Mặc định)</option>
                      <option value="top-left">Góc trên bên trái</option>
                      <option value="top-right">Góc trên bên phải</option>
                      <option value="bottom-left">Góc dưới bên trái</option>
                      <option value="bottom-right">Góc dưới bên phải</option>
                      <option value="hide">Ẩn tiêu đề & logo</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Màu chữ Tiêu đề Kênh</label>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <input 
                        type="text" 
                        value={headerTitleColor} 
                        onChange={(e) => updateHeaderTitleColor(e.target.value)} 
                        style={{ flex: 1 }}
                      />
                      <input 
                        type="color" 
                        value={headerTitleColor.startsWith('#') ? headerTitleColor : '#FFFFFF'} 
                        onChange={(e) => updateHeaderTitleColor(e.target.value)} 
                        style={{ width: '32px', height: '32px', padding: 0, cursor: 'pointer' }}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Cỡ chữ Tiêu đề Kênh (Font size)</span>
                      <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{headerTitleFontSize}px</span>
                    </label>
                    <input 
                      type="range" 
                      min="14" 
                      max="50" 
                      step="1" 
                      value={headerTitleFontSize} 
                      onChange={(e) => updateHeaderTitleFontSize(parseInt(e.target.value, 10))} 
                      style={{ cursor: 'pointer', height: '6px' }}
                    />
                    <span style={{ fontSize: '0.65rem', color: '#888', marginTop: '0.2rem', display: 'block' }}>Mặc định 28px. Điều chỉnh phù hợp với độ dài tên kênh của bạn.</span>
                  </div>
                </div>
              </div>

              {/* Mascot Sprite Sheet Config */}
              <div className="glass-card">
                <h2 className="card-title">Cấu hình Mascot từ Sprite Sheet</h2>
                <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.75rem', lineHeight: '1.4' }}>
                  Tải lên một hình ảnh duy nhất chứa chuỗi 4 tư thế Mascot xếp liền nhau theo chiều ngang trên nền trắng. 
                  Thứ tự từ trái sang phải: 
                  <strong style={{ color: 'var(--primary)' }}> 1. Đứng im ➔ 2. Chỉ trái ➔ 3. Chỉ phải ➔ 4. Nhún vai (đọc câu hỏi)</strong>.
                  Hệ thống sẽ tự động phân tách, xóa nền trắng thành trong suốt mịn màng và đồng bộ vào video.
                </p>

                <div className="form-group">
                  <label>Chọn ảnh Sprite Sheet Mascot</label>
                  <FileUploadDropzone accept="image/*" onChange={handleSpriteSheetUpload} style={{ marginTop: '0.25rem' }}>
                    <div className="file-upload-btn">
                      <Upload size={14} /> Tải ảnh Sprite Sheet
                    </div>
                  </FileUploadDropzone>
                  {spriteFileName && <span className="file-upload-preview">✓ {spriteFileName}</span>}
                </div>

                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <span>Kích thước Mascot</span>
                    <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{mascotScale}%</span>
                  </label>
                  <input 
                    type="range" 
                    min="50" 
                    max="180" 
                    step="5" 
                    value={mascotScale} 
                    onChange={(e) => updateMascotScale(parseInt(e.target.value, 10))} 
                    style={{ cursor: 'pointer', height: '6px' }}
                  />
                  <span style={{ fontSize: '0.6rem', color: '#777', marginTop: '0.2rem', display: 'block' }}>Mặc định 100%. Điều chỉnh để Mascot cân đối với chiều rộng khung hình.</span>
                </div>

                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <span>Vị trí đứng lên / xuống của Mascot (Y-Position)</span>
                    <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{mascotY}px</span>
                  </label>
                  <input 
                    type="range" 
                    min="600" 
                    max="1480" 
                    step="5" 
                    value={mascotY} 
                    onChange={(e) => updateMascotY(parseInt(e.target.value, 10))} 
                    style={{ cursor: 'pointer', height: '6px' }}
                  />
                  <span style={{ fontSize: '0.6rem', color: '#777', marginTop: '0.2rem', display: 'block' }}>Mặc định 1280px. Tăng lên (tối đa 1480px) để kéo chân Mascot chạm sát mép đáy dưới cùng video.</span>
                </div>

                {/* Tùy chỉnh Tách nền Mascot (Chroma Key & White Removal) */}
                <div className="form-group" style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px dashed rgba(255, 255, 255, 0.1)' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--accent-indigo)', display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.4rem' }}>
                    <Sparkles size={14} /> Chế độ Tách phông nền Mascot (Background Removal & Chroma Key)
                  </label>
                  <select 
                    value={mascotChromaKey} 
                    onChange={(e) => updateMascotChromaKey(e.target.value)}
                    style={{ padding: '0.5rem', fontSize: '0.8rem', marginBottom: '0.5rem' }}
                  >
                    <option value="green">🟢 Chỉ tách phông XANH LÁ (Green Screen - Giữ nguyên áo trắng & chi tiết)</option>
                    <option value="auto">✨ Tự động nhận diện phông nền (Green / White)</option>
                    <option value="white">⚪ Chỉ tách phông TRẮNG / Trắng Kem (White Removal)</option>
                    <option value="none">🚫 Tắt tách nền (Dùng phông PNG trong suốt gốc)</option>
                  </select>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255, 255, 255, 0.03)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.1)', marginTop: '0.5rem' }}>
                    <input 
                      type="checkbox" 
                      id="mascot_white_backing_chk"
                      checked={mascotWhiteBacking}
                      onChange={(e) => updateMascotWhiteBacking(e.target.checked)}
                      style={{ width: '16px', height: '16px', cursor: 'pointer', margin: 0 }}
                    />
                    <label htmlFor="mascot_white_backing_chk" style={{ fontSize: '0.75rem', color: '#fff', cursor: 'pointer', userSelect: 'none', margin: 0, fontWeight: 'bold' }}>
                      🛡️ Khôi phục áo trắng & chi tiết Mascot (Bù nền trắng lót phía sau thân)
                    </label>
                  </div>
                  <span style={{ fontSize: '0.65rem', color: '#888', display: 'block', marginTop: '0.25rem', lineHeight: '1.3' }}>
                    * Tự động bù lớp lót màu trắng bên trong thân Mascot để khắc phục triệt để hiện tượng áo trắng/cổ áo bị thủng mờ do file ảnh gốc tải lên bị tách lẹm từ trước.
                  </span>

                  {mascotChromaKey !== 'none' && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#ccc' }}>
                        <span>Độ nhạy tách nền Trắng (Threshold)</span>
                        <span style={{ color: 'var(--accent-indigo)', fontWeight: 'bold' }}>{mascotChromaThreshold}</span>
                      </label>
                      <input 
                        type="range" 
                        min="180" 
                        max="255" 
                        step="1" 
                        value={mascotChromaThreshold} 
                        onChange={(e) => updateMascotChromaThreshold(parseInt(e.target.value, 10))} 
                        style={{ cursor: 'pointer', height: '6px', width: '100%' }}
                      />
                      <span style={{ fontSize: '0.65rem', color: '#888', display: 'block', marginTop: '0.2rem', lineHeight: '1.3' }}>
                        * Tách sạch 100% hình vuông quanh Mascot trên nền tối. Bạn có thể sử dụng ảnh nền Trắng hoặc Xanh lá (Green Screen) đều được tự động tách sạch sẽ không bị lẹm.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Subtitles Custom UI Settings */}
              <div className="glass-card">
                <h2 className="card-title">Tùy biến Giao diện Phụ đề & Theme Video</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Bộ chọn Theme Nhanh cho Video (Quick Theme Presets) */}
                  <div className="form-group" style={{ padding: '0.75rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)', margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--accent-indigo)', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem' }}>
                      <Palette size={16} /> Chọn Theme Nhanh cho Video (Quick Presets)
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                      <button 
                        type="button"
                        className="btn"
                        onClick={() => applyThemePreset('light')}
                        style={{
                          padding: '0.5rem 0.6rem',
                          borderRadius: '8px',
                          border: bgColor === '#FAF6F0' ? '2px solid var(--accent-indigo)' : '1px solid rgba(255, 255, 255, 0.12)',
                          background: '#FAF6F0',
                          color: '#1e293b',
                          fontWeight: 'bold',
                          fontSize: '0.75rem',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          boxShadow: bgColor === '#FAF6F0' ? '0 0 10px rgba(99, 102, 241, 0.4)' : 'none'
                        }}
                      >
                        <span style={{ fontSize: '0.9rem' }}>☀️</span> Theme Sáng Trắng Kem
                      </button>

                      <button 
                        type="button"
                        className="btn"
                        onClick={() => applyThemePreset('dark-contrast')}
                        style={{
                          padding: '0.5rem 0.6rem',
                          borderRadius: '8px',
                          border: bgColor === '#0B0F19' ? '2px solid var(--accent-indigo)' : '1px solid rgba(255, 255, 255, 0.12)',
                          background: '#0B0F19',
                          color: '#38BDF8',
                          fontWeight: 'bold',
                          fontSize: '0.75rem',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          boxShadow: bgColor === '#0B0F19' ? '0 0 10px rgba(56, 189, 248, 0.4)' : 'none'
                        }}
                      >
                        <span style={{ fontSize: '0.9rem' }}>🌙</span> Theme Tối High-Contrast
                      </button>

                      <button 
                        type="button"
                        className="btn"
                        onClick={() => applyThemePreset('dark-neon')}
                        style={{
                          padding: '0.5rem 0.6rem',
                          borderRadius: '8px',
                          border: bgColor === '#070614' ? '2px solid var(--accent-indigo)' : '1px solid rgba(255, 255, 255, 0.12)',
                          background: '#070614',
                          color: '#00FFCC',
                          fontWeight: 'bold',
                          fontSize: '0.75rem',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          boxShadow: bgColor === '#070614' ? '0 0 10px rgba(0, 255, 204, 0.4)' : 'none'
                        }}
                      >
                        <span style={{ fontSize: '0.9rem' }}>⚡</span> Theme Tối Neon Cyber
                      </button>

                      <button 
                        type="button"
                        className="btn"
                        onClick={() => applyThemePreset('dark-gold')}
                        style={{
                          padding: '0.5rem 0.6rem',
                          borderRadius: '8px',
                          border: bgColor === '#121212' ? '2px solid var(--accent-indigo)' : '1px solid rgba(255, 255, 255, 0.12)',
                          background: '#121212',
                          color: '#FBBF24',
                          fontWeight: 'bold',
                          fontSize: '0.75rem',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          boxShadow: bgColor === '#121212' ? '0 0 10px rgba(251, 191, 36, 0.4)' : 'none'
                        }}
                      >
                        <span style={{ fontSize: '0.9rem' }}>👑</span> Theme Tối Hoàng Gia Gold
                      </button>

                      <button 
                        type="button"
                        className="btn"
                        onClick={() => applyThemePreset('dark-gradient')}
                        style={{
                          gridColumn: 'span 2',
                          padding: '0.5rem 0.6rem',
                          borderRadius: '8px',
                          border: bgColor.startsWith('linear-gradient') ? '2px solid var(--accent-indigo)' : '1px solid rgba(255, 255, 255, 0.12)',
                          background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #311042 100%)',
                          color: '#F43F5E',
                          fontWeight: 'bold',
                          fontSize: '0.75rem',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          boxShadow: bgColor.startsWith('linear-gradient') ? '0 0 10px rgba(244, 63, 94, 0.4)' : 'none'
                        }}
                      >
                        <span style={{ fontSize: '0.9rem' }}>🌌</span> Theme Gradient Biển Đêm Sang Trọng
                      </button>
                    </div>
                  </div>
                  {/* Toggle display */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0b0f19', padding: '0.6rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Hiển thị phụ đề trên Video</span>
                    <input 
                      type="checkbox" 
                      checked={showSubtitles} 
                      onChange={(e) => setShowSubtitles(e.target.checked)}
                      style={{ width: '18px', height: '18px', cursor: 'pointer', margin: 0 }}
                    />
                  </div>

                  {showSubtitles && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div className="form-grid">
                        {/* Y-Position & Font size */}
                        <div className="form-group">
                          <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Vị trí đứng của phụ đề (Y)</span>
                            <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{subtitleY}px</span>
                          </label>
                          <input 
                            type="range" 
                            min="650" 
                            max="950" 
                            step="5" 
                            value={subtitleY} 
                            onChange={(e) => updateSubtitleY(parseInt(e.target.value, 10))} 
                            style={{ cursor: 'pointer', marginTop: '0.25rem' }}
                          />
                          <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Mặc định 770px. Tăng để dịch chữ xuống thấp tránh đè hình ảnh so sánh.</span>
                        </div>

                        <div className="form-group">
                          <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Cỡ chữ phụ đề</span>
                            <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{subtitleFontSize}px</span>
                          </label>
                          <input 
                            type="range" 
                            min="24" 
                            max="60" 
                            step="1" 
                            value={subtitleFontSize} 
                            onChange={(e) => updateSubtitleFontSize(parseInt(e.target.value, 10))} 
                            style={{ cursor: 'pointer', marginTop: '0.25rem' }}
                          />
                        </div>

                        {/* Outline thickness & Font family */}
                        <div className="form-group">
                          <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Độ dày viền chữ</span>
                            <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{subtitleOutlineWidth}px</span>
                          </label>
                          <input 
                            type="range" 
                            min="0" 
                            max="12" 
                            step="1" 
                            value={subtitleOutlineWidth} 
                            onChange={(e) => updateSubtitleOutlineWidth(parseInt(e.target.value, 10))} 
                            style={{ cursor: 'pointer', marginTop: '0.25rem' }}
                          />
                        </div>

                        <div className="form-group">
                          <label>Font chữ</label>
                          <select 
                            value={subtitleFontFamily} 
                            onChange={(e) => updateSubtitleFontFamily(e.target.value)}
                            style={{ marginTop: '0.25rem' }}
                          >
                            <option value='"Montserrat", Arial, sans-serif'>Montserrat (Modern)</option>
                            <option value='Arial, sans-serif'>Arial (Clean)</option>
                            <option value='"Impact", sans-serif'>Impact (Meme Bold)</option>
                            <option value='"Outfit", sans-serif'>Outfit (Stylish)</option>
                          </select>
                        </div>

                        {/* Highlight Style & Colors */}
                        <div className="form-group">
                          <label>Kiểu hiệu ứng Highlight</label>
                          <select 
                            value={subtitleHighlightStyle} 
                            onChange={(e) => updateSubtitleHighlightStyle(e.target.value)}
                            style={{ marginTop: '0.25rem' }}
                          >
                            <option value="word-color">Đổi màu chữ từ đang đọc</option>
                            <option value="box-bg">Hộp nền màu CapCut</option>
                            <option value="grow">Phóng to nhẹ chữ đang đọc</option>
                            <option value="outline-only">Chỉ viền từ đang đọc</option>
                          </select>
                        </div>

                        <div className="form-group">
                          <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Độ rộng vùng phụ đề</span>
                            <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{subtitleMaxWidth}px</span>
                          </label>
                          <input 
                            type="range" 
                            min="300" 
                            max="650" 
                            step="10" 
                            value={subtitleMaxWidth} 
                            onChange={(e) => updateSubtitleMaxWidth(parseInt(e.target.value, 10))} 
                            style={{ cursor: 'pointer', marginTop: '0.25rem' }}
                          />
                          <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Mức khuyến nghị: 400px - 480px để giữ chữ gọn gàng.</span>
                        </div>

                        <div className="form-group">
                          <label>Số dòng tối đa hiển thị cùng lúc</label>
                          <select 
                            value={subtitleMaxLines} 
                            onChange={(e) => updateSubtitleMaxLines(parseInt(e.target.value, 10))}
                            style={{ marginTop: '0.25rem' }}
                          >
                            <option value="1">1 dòng (Chỉ dòng đang đọc)</option>
                            <option value="2">2 dòng (Dòng đang đọc & dòng tiếp theo)</option>
                            <option value="99">Tất cả các dòng (Mặc định cũ)</option>
                          </select>
                        </div>

                        <div className="form-group">
                          <label>Màu sắc phối hợp</label>
                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#0b0f19', padding: '0.25rem', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
                              <span style={{ fontSize: '0.6rem', color: '#94a3b8' }}>Màu chữ</span>
                              <input 
                                type="color" 
                                value={subtitleColor} 
                                onChange={(e) => updateSubtitleColor(e.target.value)} 
                                style={{ width: '100%', height: '24px', cursor: 'pointer', border: 'none', background: 'none', padding: 0 }}
                              />
                            </div>
                            
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#0b0f19', padding: '0.25rem', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
                              <span style={{ fontSize: '0.6rem', color: '#94a3b8' }}>Màu viền</span>
                              <input 
                                type="color" 
                                value={subtitleOutlineColor} 
                                onChange={(e) => updateSubtitleOutlineColor(e.target.value)} 
                                style={{ width: '100%', height: '24px', cursor: 'pointer', border: 'none', background: 'none', padding: 0 }}
                              />
                            </div>

                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#0b0f19', padding: '0.25rem', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
                              <span style={{ fontSize: '0.6rem', color: '#94a3b8' }}>Highlight</span>
                              <input 
                                type="color" 
                                value={subtitleHighlightColor} 
                                onChange={(e) => updateSubtitleHighlightColor(e.target.value)} 
                                style={{ width: '100%', height: '24px', cursor: 'pointer', border: 'none', background: 'none', padding: 0 }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Customize Comparison Titles (Left/Right) */}
              <div className="glass-card">
                <h2 className="card-title">Tùy biến Tiêu đề Cột So Sánh</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="form-grid">
                    {/* Title Font Size */}
                    <div className="form-group">
                      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Cỡ chữ tiêu đề</span>
                        <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{titleFontSize}px</span>
                      </label>
                      <input 
                        type="range" 
                        min="20" 
                        max="60" 
                        step="1" 
                        value={titleFontSize} 
                        onChange={(e) => updateTitleFontSize(parseInt(e.target.value, 10))} 
                        style={{ cursor: 'pointer', marginTop: '0.25rem' }}
                      />
                      <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Mặc định 36px. Áp dụng khi hai bên ở kích thước mặc định.</span>
                    </div>

                    {/* Title Outline Width */}
                    <div className="form-group">
                      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Độ dày viền chữ tiêu đề</span>
                        <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{titleOutlineWidth}px</span>
                      </label>
                      <input 
                        type="range" 
                        min="0" 
                        max="12" 
                        step="1" 
                        value={titleOutlineWidth} 
                        onChange={(e) => updateTitleOutlineWidth(parseInt(e.target.value, 10))} 
                        style={{ cursor: 'pointer', marginTop: '0.25rem' }}
                      />
                    </div>

                    {/* Title Outline Color */}
                    <div className="form-group">
                      <label>Màu viền chữ tiêu đề</label>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <div style={{ flex: 1, display: 'flex', gap: '0.5rem', alignItems: 'center', background: '#0b0f19', padding: '0.35rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
                          <input 
                            type="color" 
                            value={titleOutlineColor} 
                            onChange={(e) => updateTitleOutlineColor(e.target.value)} 
                            style={{ width: '28px', height: '24px', cursor: 'pointer', border: 'none', background: 'none', padding: 0 }}
                          />
                          <input 
                            type="text" 
                            value={titleOutlineColor} 
                            onChange={(e) => updateTitleOutlineColor(e.target.value)} 
                            style={{ flex: 1, border: 'none', background: 'none', padding: 0, fontSize: '0.75rem', color: '#fff', outline: 'none' }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Customize Left/Right Image Frame Dimensions */}
              <div className="glass-card">
                <h2 className="card-title">Cấu hình Khung Ảnh So Sánh</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <p style={{ fontSize: '0.72rem', color: '#94a3b8', lineHeight: '1.4', margin: 0 }}>
                    Điều chỉnh kích thước của hai khung ảnh bên Trái và bên Phải trên video. Hệ thống sẽ tự động căn giữa và bo góc trong suốt (overflow hidden) để ảnh không bao giờ tràn ra ngoài.
                  </p>
                  
                  <div className="form-grid">
                    {/* Frame Width */}
                    <div className="form-group">
                      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Chiều rộng khung ảnh</span>
                        <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{imageFrameWidth}px</span>
                      </label>
                      <input 
                        type="range" 
                        min="150" 
                        max="350" 
                        step="5" 
                        value={imageFrameWidth} 
                        onChange={(e) => updateImageFrameWidth(parseInt(e.target.value, 10))} 
                        style={{ cursor: 'pointer', marginTop: '0.25rem' }}
                      />
                      <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Mặc định 290px. Cả hai khung sẽ tự căn giữa 2 bên nửa màn hình.</span>
                    </div>

                    {/* Frame Height */}
                    <div className="form-group">
                      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Chiều cao khung ảnh</span>
                        <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{imageFrameHeight}px</span>
                      </label>
                      <input 
                        type="range" 
                        min="200" 
                        max="500" 
                        step="5" 
                        value={imageFrameHeight} 
                        onChange={(e) => updateImageFrameHeight(parseInt(e.target.value, 10))} 
                        style={{ cursor: 'pointer', marginTop: '0.25rem' }}
                      />
                      <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Mặc định 390px.</span>
                    </div>

                    {/* Global Image Zoom */}
                    <div className="form-group">
                      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Độ phóng to ảnh trong khung (Zoom)</span>
                        <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{globalImageZoom}%</span>
                      </label>
                      <input 
                        type="range" 
                        min="50" 
                        max="250" 
                        step="5" 
                        value={globalImageZoom} 
                        onChange={(e) => updateGlobalImageZoom(parseInt(e.target.value, 10))} 
                        style={{ cursor: 'pointer', marginTop: '0.25rem' }}
                      />
                      <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Mặc định 100%. Áp dụng cho tất cả hình so sánh.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: PUBLISH & SOCIAL MEDIA SCHEDULER */}
          {activeTab === 'publish' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Connected Accounts */}
              <div className="glass-card">
                <h2 className="card-title" style={{ marginBottom: '0.25rem' }}>Liên kết tài khoản mạng xã hội</h2>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Kết nối tài khoản của bạn để xuất bản video tự động lên đa nền tảng.
                </p>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                  {/* Facebook Page/Reels */}
                  <div style={{ 
                    background: '#0b0f19', 
                    border: fbConnected ? '1.5px solid #1877f2' : '1px solid var(--border-light)', 
                    borderRadius: '8px', 
                    padding: '1rem', 
                    textAlign: 'center',
                    boxShadow: fbConnected ? '0 0 10px rgba(24, 119, 242, 0.15)' : 'none',
                    transition: 'all 0.3s ease'
                  }}>
                    <div style={{ 
                      width: '44px', 
                      height: '44px', 
                      borderRadius: '50%', 
                      background: '#1877f2', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      margin: '0 auto 0.75rem',
                      color: '#ffffff',
                      fontWeight: 'bold',
                      fontSize: '1.25rem'
                    }}>f</div>
                    <h3 style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>Facebook Reels</h3>
                    <p style={{ fontSize: '0.7rem', color: '#888', marginBottom: '1rem', wordBreak: 'break-all' }}>
                      {fbConnected ? `Đã liên kết Page ID: ${fbPageId}` : 'Chưa liên kết tài khoản'}
                    </p>
                    <button 
                      className={`btn btn-sm ${fbConnected ? 'btn-secondary' : 'btn-primary'}`} 
                      onClick={handleToggleFbConnect}
                      style={{ width: '100%', padding: '0.35rem' }}
                    >
                      {fbConnected ? 'Hủy liên kết' : 'Kết nối'}
                    </button>
                  </div>

                  {/* YouTube Shorts */}
                  <div style={{ 
                    background: '#0b0f19', 
                    border: ytConnected ? '1.5px solid #ff0000' : '1px solid var(--border-light)', 
                    borderRadius: '8px', 
                    padding: '1rem', 
                    textAlign: 'center',
                    boxShadow: ytConnected ? '0 0 10px rgba(255, 0, 0, 0.15)' : 'none',
                    transition: 'all 0.3s ease'
                  }}>
                    <div style={{ 
                      width: '44px', 
                      height: '44px', 
                      borderRadius: '50%', 
                      background: '#ff0000', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      margin: '0 auto 0.75rem',
                      color: '#ffffff',
                      fontWeight: 'bold',
                      fontSize: '1.25rem'
                    }}>▶</div>
                    <h3 style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>YouTube Shorts</h3>
                    <p style={{ fontSize: '0.7rem', color: '#888', marginBottom: '1rem' }}>
                      {ytConnected ? 'Đã liên kết: Nam Hưu Học Shorts' : 'Chưa liên kết tài khoản'}
                    </p>
                    <button 
                      className={`btn btn-sm ${ytConnected ? 'btn-secondary' : 'btn-primary'}`} 
                      onClick={handleToggleYtConnect}
                      style={{ width: '100%', padding: '0.35rem' }}
                    >
                      {ytConnected ? 'Hủy liên kết' : 'Kết nối'}
                    </button>
                  </div>

                  {/* TikTok */}
                  <div style={{ 
                    background: '#0b0f19', 
                    border: ttConnected ? '1.5px solid #00f2fe' : '1px solid var(--border-light)', 
                    borderRadius: '8px', 
                    padding: '1rem', 
                    textAlign: 'center',
                    boxShadow: ttConnected ? '0 0 10px rgba(0, 242, 254, 0.15)' : 'none',
                    transition: 'all 0.3s ease'
                  }}>
                    <div style={{ 
                      width: '44px', 
                      height: '44px', 
                      borderRadius: '50%', 
                      background: '#010101', 
                      border: '1.5px solid #00f2fe',
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      margin: '0 auto 0.75rem',
                      color: '#ffffff',
                      fontWeight: 'bold',
                      fontSize: '1.25rem'
                    }}>🎵</div>
                    <h3 style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>TikTok Video</h3>
                    <p style={{ fontSize: '0.7rem', color: '#888', marginBottom: '1rem' }}>
                      {ttConnected ? 'Đã liên kết: @namhuuhoc.official' : 'Chưa liên kết tài khoản'}
                    </p>
                    <button 
                      className={`btn btn-sm ${ttConnected ? 'btn-secondary' : 'btn-primary'}`} 
                      onClick={handleToggleTtConnect}
                      style={{ width: '100%', padding: '0.35rem' }}
                    >
                      {ttConnected ? 'Hủy liên kết' : 'Kết nối'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Campaign / Posting Setup */}
              <div className="glass-card">
                <h2 className="card-title">Cấu hình bài viết & Lịch đăng</h2>
                
                <div className="form-grid" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
                  {/* Left block: Video selection and caption */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div className="form-group">
                      <label>Video đăng bài</label>
                      <div style={{ 
                        background: '#0b0f19', 
                        padding: '0.75rem', 
                        borderRadius: '6px', 
                        border: '1px solid var(--border-light)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem'
                      }}>
                        <div style={{ 
                          width: '45px', 
                          height: '80px', 
                          background: '#1e293b', 
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '1px solid rgba(255,255,255,0.1)',
                          flexShrink: 0,
                          overflow: 'hidden'
                        }}>
                          {exportedVideoUrl ? (
                            <video src={exportedVideoUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
                          ) : (
                            <Video size={20} style={{ color: '#64748b' }} />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 'bold', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {headerTitle ? `Video: So sánh ${headerTitle}` : 'Dự án chưa xuất video'}
                          </div>
                          <div style={{ fontSize: '0.65rem', color: exportedVideoUrl ? 'var(--accent-green)' : '#f59e0b', marginTop: '0.15rem' }}>
                            {exportedVideoUrl ? '✓ Sẵn sàng xuất bản' : '⚠ Bạn cần xuất video MP4/WebM trước khi đăng'}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="form-group">
                      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Nội dung mô tả (Caption)</span>
                        <span style={{ color: '#64748b' }}>{publishCaption.length} ký tự</span>
                      </label>
                      <textarea 
                        value={publishCaption}
                        onChange={(e) => setPublishCaption(e.target.value)}
                        placeholder="Nhập caption mô tả video, hashtag..."
                        style={{ height: '110px', fontSize: '0.8rem', resize: 'none', lineHeight: '1.4' }}
                      />
                      {/* Short hashtags helper */}
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                        {['#sosanh', '#khampha', '#shorts', '#reels', '#tiktok'].map(tag => (
                          <span 
                            key={tag} 
                            onClick={() => setPublishCaption(prev => prev + (prev ? ' ' : '') + tag)}
                            style={{ 
                              fontSize: '0.65rem', 
                              background: 'var(--border-light)', 
                              padding: '0.2rem 0.4rem', 
                              borderRadius: '4px', 
                              cursor: 'pointer',
                              border: '1px solid rgba(255,255,255,0.05)',
                              transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => e.target.style.borderColor = 'var(--primary)'}
                            onMouseLeave={e => e.target.style.borderColor = 'rgba(255,255,255,0.05)'}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right block: Platform select & timing */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', borderLeft: '1px solid rgba(255,255,255,0.05)', paddingLeft: '1rem' }}>
                    <div className="form-group">
                      <label>Nền tảng đích</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                          <input 
                            type="checkbox" 
                            checked={publishPlatforms.facebook} 
                            onChange={(e) => setPublishPlatforms({ ...publishPlatforms, facebook: e.target.checked })}
                            style={{ width: '15px', height: '15px', margin: 0 }}
                          />
                          Facebook Reels
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                          <input 
                            type="checkbox" 
                            checked={publishPlatforms.youtube} 
                            onChange={(e) => setPublishPlatforms({ ...publishPlatforms, youtube: e.target.checked })}
                            style={{ width: '15px', height: '15px', margin: 0 }}
                          />
                          YouTube Shorts
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                          <input 
                            type="checkbox" 
                            checked={publishPlatforms.tiktok} 
                            onChange={(e) => setPublishPlatforms({ ...publishPlatforms, tiktok: e.target.checked })}
                            style={{ width: '15px', height: '15px', margin: 0 }}
                          />
                          TikTok Video
                        </label>
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Chế độ đăng</label>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <button 
                          className={`btn btn-sm ${publishMode === 'now' ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setPublishMode('now')}
                          style={{ flex: 1, padding: '0.4rem' }}
                        >
                          Đăng ngay
                        </button>
                        <button 
                          className={`btn btn-sm ${publishMode === 'schedule' ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setPublishMode('schedule')}
                          style={{ flex: 1, padding: '0.4rem' }}
                        >
                          Hẹn giờ
                        </button>
                      </div>
                    </div>

                    {publishMode === 'schedule' && (
                      <div className="form-group" style={{ animation: 'fadeIn 0.3s ease' }}>
                        <label>Chọn Ngày & Giờ đăng bài</label>
                        <input 
                          type="datetime-local" 
                          value={scheduleDate}
                          onChange={(e) => setScheduleDate(e.target.value)}
                          style={{ 
                            padding: '0.4rem', 
                            fontSize: '0.8rem', 
                            background: '#0b0f19', 
                            color: '#fff', 
                            border: '1px solid var(--border-light)', 
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        />
                      </div>
                    )}

                    <button 
                      className="btn btn-primary" 
                      onClick={handleAddSchedule}
                      style={{ marginTop: 'auto', padding: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                    >
                      {publishMode === 'schedule' ? <Calendar size={14} /> : <Share2 size={14} />}
                      {publishMode === 'schedule' ? 'Xác nhận đặt lịch' : 'Đăng video ngay'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Scheduled Posts Queue */}
              <div className="glass-card">
                <h2 className="card-title" style={{ marginBottom: '0.5rem' }}>Lịch trình đăng bài ({scheduledPosts.length})</h2>
                {scheduledPosts.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '1.5rem', background: '#0b0f19', borderRadius: '6px', border: '1px solid var(--border-light)', color: '#64748b', fontSize: '0.75rem' }}>
                    Chưa có lịch trình đăng bài nào được thiết lập.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto', background: '#0b0f19', borderRadius: '6px', border: '1px solid var(--border-light)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-light)', color: '#94a3b8', background: 'rgba(255,255,255,0.02)' }}>
                          <th style={{ padding: '0.5rem 0.75rem' }}>Dự án</th>
                          <th style={{ padding: '0.5rem 0.75rem' }}>Mô tả bài đăng</th>
                          <th style={{ padding: '0.5rem 0.75rem' }}>Nền tảng</th>
                          <th style={{ padding: '0.5rem 0.75rem' }}>Thời gian</th>
                          <th style={{ padding: '0.5rem 0.75rem' }}>Trạng thái</th>
                          <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scheduledPosts.map((post) => (
                          <tr key={post.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                            <td style={{ padding: '0.5rem 0.75rem', fontWeight: 'bold' }}>
                              {post.headerTitle || 'So sánh'}
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem', color: '#cbd5e1', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {post.caption}
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem' }}>
                              <div style={{ display: 'flex', gap: '0.25rem' }}>
                                {post.platforms.map(plat => {
                                  const colors = {
                                    facebook: { bg: 'rgba(24, 119, 242, 0.15)', text: '#1877f2' },
                                    youtube: { bg: 'rgba(255, 0, 0, 0.15)', text: '#ff0000' },
                                    tiktok: { bg: 'rgba(0, 242, 254, 0.15)', text: '#00f2fe' }
                                  };
                                  const c = colors[plat] || { bg: '#222', text: '#fff' };
                                  return (
                                    <span key={plat} style={{ 
                                      background: c.bg, 
                                      color: c.text, 
                                      padding: '0.1rem 0.35rem', 
                                      borderRadius: '4px', 
                                      fontSize: '0.6rem',
                                      fontWeight: 'bold',
                                      textTransform: 'uppercase'
                                    }}>{plat}</span>
                                  );
                                })}
                              </div>
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8' }}>
                              {post.date}
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem' }}>
                              {post.status === 'published' ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--accent-green)' }}>
                                    <CheckCircle size={12} /> Đã đăng
                                  </span>
                                  {post.platforms.includes('facebook') && (
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => handleCheckFbReelStatus(post)}
                                      style={{ padding: '0.1rem 0.3rem', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.2rem', width: 'fit-content', background: 'rgba(24, 119, 242, 0.1)', color: '#1877f2', border: '1px solid rgba(24, 119, 242, 0.2)' }}
                                    >
                                      <RefreshCw size={10} /> Check FB Reels
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#f59e0b' }}>
                                  <Clock size={12} style={{ animation: 'pulse 1.5s infinite' }} /> Đang chờ
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                                {post.projectConfig && (
                                  <button 
                                    className="btn btn-secondary btn-sm" 
                                    style={{ padding: '0.2rem', height: '22px', border: '1px solid var(--accent-indigo)', color: 'var(--accent-indigo)', background: 'rgba(99, 102, 241, 0.05)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} 
                                    onClick={() => handleLoadProjectConfig(post.projectConfig)}
                                    title="Tải cấu hình vào Workflow"
                                  >
                                    <FolderOpen size={12} />
                                  </button>
                                )}
                                <button 
                                  className="btn btn-danger btn-sm" 
                                  style={{ padding: '0.2rem', height: '22px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} 
                                  onClick={() => handleDeleteSchedule(post.id)}
                                  title="Xóa bài đăng"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* AI Comment Responder Dashboard */}
              <div className="glass-card" style={{ marginTop: '1rem', border: botEnabled ? '1.5px solid var(--accent-green)' : '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ 
                      width: '10px', 
                      height: '10px', 
                      borderRadius: '50%', 
                      background: botEnabled ? 'var(--accent-green)' : '#64748b',
                      boxShadow: botEnabled ? '0 0 8px var(--accent-green)' : 'none',
                      animation: botEnabled ? 'pulse 1.5s infinite' : 'none'
                    }} />
                    <h2 className="card-title" style={{ margin: 0 }}>Trợ lý Phản hồi Bình luận AI (AI Responder)</h2>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => scanComments(true)}
                      disabled={isScanning}
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                      <RefreshCw size={12} style={{ animation: isScanning ? 'spin 1.5s linear infinite' : 'none' }} />
                      {isScanning ? 'Đang quét...' : 'Quét bình luận ngay'}
                    </button>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 'bold' }}>
                      <input 
                        type="checkbox" 
                        checked={botEnabled} 
                        onChange={(e) => setBotEnabled(e.target.checked)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      Kích hoạt Bot Tự động
                    </label>
                  </div>
                </div>

                <div className="form-grid" style={{ gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
                  {/* Cấu hình Prompt và API Key */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div className="form-group">
                      <label>Nhà cung cấp AI & API Key</label>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <select 
                          value={commentAiProvider} 
                          onChange={(e) => setCommentAiProvider(e.target.value)}
                          style={{ 
                            padding: '0.4rem', 
                            fontSize: '0.8rem', 
                            background: '#0b0f19', 
                            color: '#fff', 
                            border: '1px solid var(--border-light)', 
                            borderRadius: '4px',
                            width: '120px'
                          }}
                        >
                          <option value="gemini">Google Gemini</option>
                          <option value="groq">Groq AI (Llama 3)</option>
                          <option value="openrouter">OpenRouter (Free Llama)</option>
                          <option value="openai">OpenAI GPT</option>
                        </select>
                        <ApiKeyInput 
                          placeholder={`Nhập API Key ${commentAiProvider === 'gemini' ? 'Gemini' : 'OpenAI'}...`}
                          value={commentAiApiKey}
                          onChange={(e) => setCommentAiApiKey(e.target.value)}
                          style={{ 
                            padding: '0.4rem', 
                            fontSize: '0.8rem', 
                            background: '#0b0f19', 
                            color: '#fff', 
                            border: '1px solid var(--border-light)', 
                            borderRadius: '4px' 
                          }}
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Hướng dẫn AI (System Prompt) - Trả lời phản hồi thông minh</label>
                      <textarea 
                        value={commentSystemPrompt}
                        onChange={(e) => setCommentSystemPrompt(e.target.value)}
                        placeholder="Hướng dẫn AI cách trả lời bình luận..."
                        style={{ 
                          width: '100%', 
                          height: '90px', 
                          marginTop: '0.25rem', 
                          fontSize: '0.75rem', 
                          resize: 'none',
                          lineHeight: '1.4'
                        }}
                      />
                    </div>

                    <div className="form-group" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
                      <label>Theo dõi bình luận trên Video ID khác (Thủ công)</label>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <input 
                          type="text" 
                          placeholder="Dán ID Video Facebook cần theo dõi..."
                          value={manualVideoId}
                          onChange={(e) => setManualVideoId(e.target.value)}
                          style={{ 
                            flex: 1, 
                            padding: '0.4rem', 
                            fontSize: '0.8rem', 
                            background: '#0b0f19', 
                            color: '#fff', 
                            border: '1px solid var(--border-light)', 
                            borderRadius: '4px' 
                          }}
                        />
                        <button 
                          className="btn btn-sm btn-primary"
                          onClick={handleAddManualVideo}
                          style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem' }}
                        >
                          Theo dõi
                        </button>
                      </div>
                      <p style={{ fontSize: '0.65rem', color: '#64748b', margin: '0.25rem 0 0 0' }}>
                        Nhập ID của Reel/Video đã đăng từ trước (Ví dụ lấy từ link share: /share/r/ID/) để bot quét bình luận.
                      </p>
                    </div>
                  </div>

                  {/* Lịch sử hoạt động / Logs */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderLeft: '1px solid rgba(255,255,255,0.05)', paddingLeft: '1rem' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Lịch sử phản hồi ({commentLogs.length})</label>
                    <div style={{ 
                      flex: 1, 
                      background: '#0b0f19', 
                      borderRadius: '6px', 
                      border: '1px solid var(--border-light)', 
                      padding: '0.5rem',
                      height: '160px',
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem'
                    }}>
                      {commentLogs.length === 0 ? (
                        <div style={{ color: '#64748b', fontSize: '0.7rem', textAlign: 'center', marginTop: '3rem' }}>
                          Chưa có lịch sử phản hồi nào. Bot sẽ tự động trả lời khi phát hiện bình luận mới trên các video đã đăng.
                        </div>
                      ) : (
                        commentLogs.map((log) => (
                          <div key={log.id} style={{ 
                            background: 'rgba(255,255,255,0.02)', 
                            padding: '0.4rem 0.5rem', 
                            borderRadius: '4px',
                            border: '1px solid rgba(255,255,255,0.03)',
                            fontSize: '0.7rem',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.2rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                              <strong>{log.user} (Video: {log.postTitle})</strong>
                              <span>{log.time}</span>
                            </div>
                            <div style={{ color: '#cbd5e1', fontStyle: 'italic' }}>Comment: "{log.commentText}"</div>
                            <div style={{ color: 'var(--accent-green)', paddingLeft: '0.5rem', borderLeft: '2px solid var(--accent-green)' }}>
                              AI Rep: {log.replyText}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    {commentLogs.length > 0 && (
                      <button 
                        className="btn btn-sm btn-secondary" 
                        onClick={() => setCommentLogs([])}
                        style={{ alignSelf: 'flex-end', fontSize: '0.65rem', padding: '0.15rem 0.4rem' }}
                      >
                        Xóa lịch sử
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

        </section>

        {/* Right Column: Dialogue Text Script Panel */}
        <section className="script-panel">
          <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <h2 className="card-title" style={{ margin: 0 }}>Kịch bản hội thoại</h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Mỗi dòng đại diện cho một nhịp nói của video. Nhập đoạn hội thoại ChatGPT/Gemini sinh ra vào đây và bấm nút bên dưới.
            </p>
            
            <textarea 
              value={scriptText} 
              onChange={(e) => setScriptText(e.target.value)} 
              placeholder="Paste dialogue script here..."
              style={{ flex: 1, resize: 'none', lineHeight: '1.5', fontFamily: 'monospace' }}
            />

            <button 
              className="btn btn-primary" 
              onClick={handleParseScript}
              style={{ width: '100%', padding: '0.6rem' }}
            >
              <RefreshCw size={14} /> Nhập & Phân tích kịch bản
            </button>
          </div>
        </section>

      </div>

      {/* Render Progress Modal with Live Preview and Sound Control */}
      {isExporting && (
        <div className="render-overlay">
          <div className="render-progress-card-flex">
            
            {/* Left Column: Progress details and Mute button */}
            <div className="render-progress-left">
              <h2 className="render-title">ĐANG XUẤT BẢN VIDEO</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                Hệ thống đang vẽ hình ảnh, nhân vật hoạt hình và ghép luồng âm thanh. Vui lòng giữ tab này mở...
              </p>
              
              <div className="progress-bar-bg" style={{ marginTop: '0.5rem' }}>
                <div className="progress-bar-fill" style={{ width: `${exportProgress}%` }}></div>
              </div>
              
              <div className="progress-text" style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--primary)' }}>
                {exportProgress}% Hoàn thành
              </div>

              {/* Volume toggle control */}
              <button 
                onClick={handleToggleExportMute}
                className="btn btn-secondary"
                style={{ 
                  alignSelf: 'center', 
                  marginTop: '0.75rem', 
                  padding: '0.5rem 1rem', 
                  gap: '0.4rem',
                  borderRadius: '20px',
                  fontSize: '0.8rem'
                }}
              >
                {isExportMuted ? <VolumeX size={14} className="text-danger" style={{ color: 'var(--accent-red)' }} /> : <Volume2 size={14} className="text-success" style={{ color: 'var(--accent-green)' }} />}
                {isExportMuted ? 'Bật âm thanh preview' : 'Tắt âm thanh preview'}
              </button>
            </div>

            {/* Right Column: Live frame rendering preview */}
            <div className="render-progress-right">
              <div style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--accent-yellow)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                Khung hình đang render thực tế
              </div>
              <div className="export-preview-container">
                <canvas ref={exportCanvasRef} className="export-preview-canvas" width={720} height={1280} />
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Social Media Credentials Connection Modals */}
      {activeConnectModal && (
        <div className="render-overlay">
          <div className="glass-card" style={{ width: '100%', maxWidth: '400px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid var(--border-light)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
            <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textTransform: 'capitalize' }}>
              <Share2 size={16} /> Kết nối {activeConnectModal}
            </h2>
            
            <form onSubmit={
              activeConnectModal === 'facebook' ? handleSaveFbCredentials :
              activeConnectModal === 'youtube' ? handleSaveYtCredentials :
              handleSaveTtCredentials
            } style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {activeConnectModal === 'facebook' && (
                <>
                  <div className="form-group">
                    <label>Page ID</label>
                    <input 
                      type="text" 
                      placeholder="Nhập Facebook Page ID..." 
                      value={fbPageId} 
                      onChange={(e) => setFbPageId(e.target.value)} 
                      style={{ padding: '0.45rem', fontSize: '0.8rem', background: '#0b0f19', border: '1px solid var(--border-light)', color: '#fff', borderRadius: '4px' }}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Page Access Token</label>
                    <ApiKeyInput 
                      placeholder="EAAW..." 
                      value={fbAccessToken} 
                      onChange={(e) => setFbAccessToken(e.target.value)} 
                      style={{ padding: '0.45rem', fontSize: '0.8rem', background: '#0b0f19', border: '1px solid var(--border-light)', color: '#fff', borderRadius: '4px' }}
                      required
                    />
                  </div>
                </>
              )}

              {activeConnectModal === 'youtube' && (
                <>
                  <div className="form-group">
                    <label>Channel ID</label>
                    <input 
                      type="text" 
                      placeholder="UC..." 
                      value={ytChannelId} 
                      onChange={(e) => setYtChannelId(e.target.value)} 
                      style={{ padding: '0.45rem', fontSize: '0.8rem', background: '#0b0f19', border: '1px solid var(--border-light)', color: '#fff', borderRadius: '4px' }}
                      required
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>API Key / OAuth Access Token (1 giờ)</label>
                    <ApiKeyInput 
                      placeholder="ya29... (Bỏ trống nếu dùng tự động làm mới ở dưới)" 
                      value={ytAccessToken} 
                      onChange={(e) => setYtAccessToken(e.target.value)} 
                      style={{ padding: '0.45rem', fontSize: '0.8rem', background: '#0b0f19', border: '1px solid var(--border-light)', color: '#fff', borderRadius: '4px' }}
                    />
                  </div>

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.75rem', marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--primary)' }}>⚙️ Cấu hình Tự động làm mới Token (Gia hạn vĩnh viễn)</span>
                    <p style={{ fontSize: '0.65rem', color: '#94a3b8', margin: 0, lineHeight: '1.4' }}>
                      Điền đủ 3 ô dưới đây để hệ thống tự động sinh Access Token mới mỗi khi đăng Shorts mà không lo hết hạn.
                    </p>

                    <div className="form-group">
                      <label>OAuth Client ID</label>
                      <input 
                        type="text" 
                        placeholder="Nhập Client ID của bạn..." 
                        value={ytClientId} 
                        onChange={(e) => setYtClientId(e.target.value)} 
                        style={{ padding: '0.45rem', fontSize: '0.8rem', background: '#0b0f19', border: '1px solid var(--border-light)', color: '#fff', borderRadius: '4px' }}
                      />
                    </div>

                    <div className="form-group">
                      <label>OAuth Client Secret</label>
                      <ApiKeyInput 
                        placeholder="Nhập Client Secret..." 
                        value={ytClientSecret} 
                        onChange={(e) => setYtClientSecret(e.target.value)} 
                        style={{ padding: '0.45rem', fontSize: '0.8rem', background: '#0b0f19', border: '1px solid var(--border-light)', color: '#fff', borderRadius: '4px' }}
                      />
                    </div>

                    <div className="form-group">
                      <label>OAuth Refresh Token</label>
                      <ApiKeyInput 
                        placeholder="Mã 1//... lấy từ Google Playground" 
                        value={ytRefreshToken} 
                        onChange={(e) => setYtRefreshToken(e.target.value)} 
                        style={{ padding: '0.45rem', fontSize: '0.8rem', background: '#0b0f19', border: '1px solid var(--border-light)', color: '#fff', borderRadius: '4px' }}
                      />
                    </div>
                  </div>
                </>
              )}

              {activeConnectModal === 'tiktok' && (
                <>
                  <div className="form-group">
                    <label>Session ID / Account name</label>
                    <input 
                      type="text" 
                      placeholder="Nhập tên tài khoản hoặc Session ID..." 
                      value={ttSessionId} 
                      onChange={(e) => setTtSessionId(e.target.value)} 
                      style={{ padding: '0.45rem', fontSize: '0.8rem', background: '#0b0f19', border: '1px solid var(--border-light)', color: '#fff', borderRadius: '4px' }}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Developer Access Token</label>
                    <ApiKeyInput 
                      placeholder="act.tkt..." 
                      value={ttAccessToken} 
                      onChange={(e) => setTtAccessToken(e.target.value)} 
                      style={{ padding: '0.45rem', fontSize: '0.8rem', background: '#0b0f19', border: '1px solid var(--border-light)', color: '#fff', borderRadius: '4px' }}
                      required
                    />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => setActiveConnectModal(null)}
                  style={{ flex: 1, padding: '0.5rem' }}
                >
                  Hủy bỏ
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '0.5rem' }}
                >
                  Lưu & Kết nối
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Publishing Progress Overlay Modal */}
      {isPublishing && (
        <div className="render-overlay">
          <style>{`
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}</style>
          <div className="render-progress-card" style={{ padding: '2rem', textAlign: 'center', width: '100%', maxWidth: '380px' }}>
            <h2 className="render-title" style={{ color: 'var(--primary)', letterSpacing: '1px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.95rem' }}>
              <Clock style={{ animation: 'spin 1.5s linear infinite' }} size={18} /> ĐANG XUẤT BẢN VIDEO LÊN MXH
            </h2>
            
            <div style={{ margin: '1.5rem auto 1rem', display: 'flex', justifyContent: 'center' }}>
              <svg style={{ width: '42px', height: '42px', color: 'var(--primary)', animation: 'spin 1s linear infinite' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle style={{ opacity: 0.2 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path style={{ opacity: 0.8 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>

            <p style={{ fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 'bold', margin: '0.5rem 0' }}>
              {publishingStatus}
            </p>
            <p style={{ fontSize: '0.65rem', color: '#64748b', lineHeight: '1.4' }}>
              Hệ thống đang tải video nhị phân và gửi yêu cầu API xuất bản. Vui lòng giữ tab này mở...
            </p>
          </div>
        </div>
      )}

      {/* VClip Key Manager Modal */}
      {showVclipKeyModal && (
        <div className="render-overlay" style={{ zIndex: 1100 }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '620px', padding: '1.5rem', maxHeight: '90vh', overflowY: 'auto', background: '#0f172a', border: '1px solid var(--accent-indigo)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.75rem' }}>
              <h2 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem', color: '#818cf8' }}>
                <Key size={18} color="var(--primary)" /> Quản lý Danh sách Key VClip (Auto-Switch 1 Tháng)
              </h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowVclipKeyModal(false)} style={{ padding: '0.2rem 0.5rem' }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#cbd5e1', lineHeight: '1.5', background: 'rgba(99, 102, 241, 0.1)', padding: '0.75rem', borderRadius: '6px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                <strong>💡 Hướng dẫn định dạng:</strong> Nhập danh sách Key VClip (mỗi key 1 dòng theo cú pháp: <code>API_KEY | YYYY-MM-DD</code>).<br />
                - Khi tạo voice bị hết Credit (2.5k gói free), hệ thống <b>tự động chuyển sang Key dự phòng tiếp theo</b>.<br />
                - Key bị đánh dấu hết Credit sẽ <b>mờ tối đi</b> và đếm ngược <b>30 ngày</b>. Sau 1 tháng, Credit sẽ được VClip nạp lại và Key tự động khôi phục khả dụng!
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Nhập / Sửa Danh sách Key (Textarea):</label>
                <textarea
                  rows={6}
                  value={vclipRawKeyText}
                  onChange={(e) => {
                    setVclipRawKeyText(e.target.value);
                    setVclipKeyItems(parseVclipKeyText(e.target.value));
                  }}
                  placeholder={`sk_live_KeyExample1 | 2026-07-24\nsk_live_KeyExample2 | 2026-07-10 | exhausted`}
                  style={{ fontFamily: 'monospace', fontSize: '0.75rem', background: '#0b0f19', color: '#38bdf8', padding: '0.6rem', border: '1px solid #334155', borderRadius: '6px' }}
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold', margin: 0 }}>Danh sách Trạng thái Keys ({vclipKeyItems.length})</label>
                  <span style={{ fontSize: '0.7rem', color: activeUsableKeyCount > 0 ? '#34d399' : '#f43f5e', fontWeight: 'bold' }}>
                    {activeUsableKeyCount} Key sẵn sàng hoạt động
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '240px', overflowY: 'auto', paddingRight: '0.2rem' }}>
                  {vclipKeyItems.length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic', textAlign: 'center', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                      Chưa có API Key nào trong danh sách. Hãy dán key vào ô textarea phía trên.
                    </div>
                  ) : (
                    vclipKeyItems.map((item, idx) => {
                      const info = getVclipKeyStatusInfo(item);
                      const isSelected = item.key === vclipApiKey;

                      return (
                        <div 
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.5rem 0.75rem',
                            borderRadius: '6px',
                            border: isSelected ? '1px solid var(--accent-indigo)' : '1px solid rgba(255,255,255,0.08)',
                            background: isSelected ? 'rgba(99, 102, 241, 0.18)' : !info.isUsable ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255,255,255,0.03)',
                            opacity: !info.isUsable ? 0.45 : 1.0,
                            filter: !info.isUsable ? 'grayscale(0.6)' : 'none',
                            transition: 'all 0.2s'
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 'bold', fontFamily: 'monospace', color: isSelected ? '#a5b4fc' : '#e2e8f0', textDecoration: !info.isUsable ? 'line-through' : 'none' }}>
                                #{idx + 1}. {item.key.substring(0, 14)}...{item.key.slice(-4)}
                              </span>
                              {isSelected && (
                                <span style={{ fontSize: '0.6rem', background: 'var(--accent-indigo)', color: '#fff', padding: '0.1rem 0.35rem', borderRadius: '3px', fontWeight: 'bold' }}>
                                  ĐANG DÙNG
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                              Ngày tạo: {item.createdDate} | 
                              {info.isUsable ? (
                                <span style={{ color: '#34d399', marginLeft: '0.3rem', fontWeight: 'bold' }}>🟢 Sẵn sàng (Còn Credit)</span>
                              ) : (
                                <span style={{ color: '#f43f5e', marginLeft: '0.3rem', fontWeight: 'bold' }}>🔴 Hết Credit (Mở lại sau {info.daysLeft} ngày)</span>
                              )}
                            </span>
                          </div>

                          <div style={{ display: 'flex', gap: '0.3rem' }}>
                            {info.isUsable && !isSelected && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ fontSize: '0.65rem', padding: '0.2rem 0.45rem', background: 'rgba(99, 102, 241, 0.2)', border: '1px solid var(--accent-indigo)', color: '#818cf8' }}
                                onClick={() => handleSelectActiveVclipKey(item.key)}
                              >
                                Dùng Key này
                              </button>
                            )}

                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: '0.65rem', padding: '0.2rem 0.45rem', color: item.status === 'exhausted' ? '#34d399' : '#f43f5e', border: item.status === 'exhausted' ? '1px solid #10b981' : '1px solid #f43f5e' }}
                              onClick={() => handleToggleVclipKeyStatus(item.key)}
                              title={item.status === 'exhausted' ? 'Khôi phục Key' : 'Đánh dấu hết Credit'}
                            >
                              {item.status === 'exhausted' ? 'Mở lại Key' : 'Báo hết Credit'}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => setShowVclipKeyModal(false)}
                  style={{ flex: 1, padding: '0.5rem' }}
                >
                  Đóng
                </button>
                <button 
                  type="button" 
                  className="btn btn-primary"
                  onClick={handleSaveVclipKeyModal}
                  style={{ flex: 1, padding: '0.5rem' }}
                >
                  Lưu Danh sách Keys
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
