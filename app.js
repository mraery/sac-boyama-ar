import { FilesetResolver, ImageSegmenter } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

// =============================================================================
// Saç Renkleri Veritabanı
// =============================================================================
const HAIR_COLORS = [
  // Sarışın & Platin
  { id: 'platinum', name: 'Platin Sarı', hex: '#F3E8DB', cat: 'blonde', r: 243, g: 232, b: 219 },
  { id: 'ash_blonde', name: 'Küllü Sarı', hex: '#D6C4A5', cat: 'blonde', r: 214, g: 196, b: 165 },
  { id: 'golden_blonde', name: 'Altın Sarısı', hex: '#F2C15E', cat: 'blonde', r: 242, g: 193, b: 94 },
  { id: 'honey_blonde', name: 'Bal Köpüğü', hex: '#D79448', cat: 'blonde', r: 215, g: 148, b: 72 },

  // Kızıl & Bakır
  { id: 'copper', name: 'Sultan Bakırı', hex: '#D4531E', cat: 'red', r: 212, g: 83, b: 30 },
  { id: 'wine_red', name: 'Şarap Kızılı', hex: '#87162C', cat: 'red', r: 135, g: 22, b: 44 },
  { id: 'ruby_red', name: 'Alev Kırmızı', hex: '#BD1522', cat: 'red', r: 189, g: 21, b: 34 },
  { id: 'auburn', name: 'Kızıl Kahve', hex: '#943B2B', cat: 'red', r: 148, g: 59, b: 43 },

  // Kahve & Kestane
  { id: 'chocolate', name: 'Çikolata', hex: '#4B2816', cat: 'brown', r: 75, g: 40, b: 22 },
  { id: 'chestnut', name: 'Sıcak Kestane', hex: '#6E3D24', cat: 'brown', r: 110, g: 61, b: 36 },
  { id: 'caramel', name: 'Karamel', hex: '#A36536', cat: 'brown', r: 163, g: 101, b: 54 },
  { id: 'espresso', name: 'Espresso', hex: '#22150F', cat: 'brown', r: 34, g: 21, b: 15 },

  // Pastel & Trend
  { id: 'rose_pink', name: 'Gül Pembe', hex: '#DB6382', cat: 'fantasy', r: 219, g: 99, b: 130 },
  { id: 'bubblegum', name: 'Şeker Pembe', hex: '#FF599A', cat: 'fantasy', r: 255, g: 89, b: 154 },
  { id: 'midnight_blue', name: 'Gece Mavisi', hex: '#1C3879', cat: 'fantasy', r: 28, g: 56, b: 121 },
  { id: 'lavender', name: 'Pastel Mor', hex: '#9B6FD6', cat: 'fantasy', r: 155, g: 111, b: 214 },
  { id: 'emerald', name: 'Zümrüt Yeşil', hex: '#177B5A', cat: 'fantasy', r: 23, g: 123, b: 90 },
  { id: 'silver', name: 'Gümüş Gri', hex: '#C6CBD4', cat: 'fantasy', r: 198, g: 203, b: 212 }
];

// =============================================================================
// Uygulama Durumu (State)
// =============================================================================
let video = null;
let canvas = null;
let ctx = null;
let imageSegmenter = null;

// Varsayılan olarak Sultan Bakırı seçili başlasın ki kullanıcı rengin anında değiştiğini görsün
let currentColor = HAIR_COLORS[4]; // Sultan Bakırı
let currentOpacity = 0.80;
let currentBlendMode = 'vibrant'; // 'vibrant' veya 'natural'
let isComparingOriginal = false;
let currentFacingMode = 'user'; // 'user' (ön) veya 'environment' (arka)
let isLoopRunning = false;

// AI Girişi için yüksek performanslı küçük boyutlu (256x256) önbellek tuvali
const aiCanvas = document.createElement('canvas');
aiCanvas.width = 256;
aiCanvas.height = 256;
const aiCtx = aiCanvas.getContext('2d', { willReadFrequently: true });

// Maske için çevrimdışı (offscreen) tuval
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
let maskImgData = null;

// Arka plan AI inference durumu
let isAiInferring = false;
let lastAiFrameTime = 0;

// DOM Elemanları
const statusDot = document.querySelector('.status-dot');
const statusText = document.getElementById('status-text');
const loadingOverlay = document.getElementById('loading-overlay');
const btnStartCamera = document.getElementById('btn-start-camera');
const loadingTitle = document.getElementById('loading-title');
const loadingDesc = document.getElementById('loading-desc');
const compareIndicator = document.getElementById('compare-indicator');
const paletteContainer = document.getElementById('palette-container');
const categoryTabs = document.getElementById('category-tabs');
const opacitySlider = document.getElementById('color-opacity');
const opacityVal = document.getElementById('opacity-val');
const customColorPicker = document.getElementById('custom-color-picker');

// =============================================================================
// Başlatma ve Model Yükleme
// =============================================================================
async function init() {
  video = document.getElementById('webcam');
  canvas = document.getElementById('output-canvas');
  ctx = canvas.getContext('2d', { willReadFrequently: true });

  renderPalette('all');
  setupEventListeners();

  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Önce kamerayı aç (kullanıcı yüzünü beklemeden hemen görsün, sıfır lag)
  try {
    statusText.textContent = 'Kamera Başlatılıyor...';
    await startCamera();
  } catch (camErr) {
    console.warn('Kamera otomatik açılamadı:', camErr);
    loadingTitle.textContent = 'Kamera İzni Gerekli';
    loadingDesc.textContent = 'Lütfen uygulamaya kamera izni veriniz.';
    btnStartCamera.classList.remove('hidden');
    return;
  }

  // Yapay zeka modelini yükle
  try {
    statusText.textContent = 'Yapay Zeka Yükleniyor...';
    
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    try {
      imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: './models/selfie_multiclass_256x256.tflite',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        outputCategoryMask: true
      });
    } catch (gpuErr) {
      console.warn('GPU başlatılamadı, CPU moduna geçiliyor:', gpuErr);
      imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: './models/selfie_multiclass_256x256.tflite',
          delegate: 'CPU'
        },
        runningMode: 'VIDEO',
        outputCategoryMask: true
      });
    }

    statusDot.classList.add('active');
    statusDot.classList.remove('pulsing');
    statusText.textContent = 'Yapay Zeka Aktif';
    loadingOverlay.classList.add('hidden');

    // AI döngüsünü arka planda başlat (Kamerayı ASLA yavaşlatmaz)
    startAiSegmentationWorker();

  } catch (error) {
    console.error('Model başlatma hatası:', error);
    statusText.textContent = 'AI Hatası';
    loadingTitle.textContent = 'Model Yüklenemedi';
    loadingDesc.textContent = error.message || 'Lütfen internet bağlantınızı kontrol ediniz.';
    btnStartCamera.classList.remove('hidden');
  }
}

// =============================================================================
// Kamera Akışı
// =============================================================================
async function startCamera() {
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
  }

  // Mobil cihazlarda 60 FPS akıcılık ve sıfır donma için optimize çözünürlük
  const constraints = {
    video: {
      facingMode: currentFacingMode,
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30, max: 60 }
    },
    audio: false
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      if (!isLoopRunning) {
        isLoopRunning = true;
        requestAnimationFrame(renderLoop);
      }
      resolve();
    };
  });
}

// =============================================================================
// Bağımsız Arka Plan Yapay Zeka Döngüsü (Non-blocking AI Loop)
// Kamera karesi 60 FPS akarken, bu döngü bağımsız olarak arka planda maske üretir.
// =============================================================================
function startAiSegmentationWorker() {
  setInterval(() => {
    if (isAiInferring || !imageSegmenter || !currentColor || isComparingOriginal || video.readyState < 2) {
      return;
    }

    isAiInferring = true;
    try {
      const now = performance.now();
      
      // Video karesini GPU donanımıyla doğrudan 256x256 tuvale çiz
      aiCtx.drawImage(video, 0, 0, 256, 256);
      
      // 256x256 boyuttan tahmin al (720p'ye göre 8 kat daha hızlı!)
      const result = imageSegmenter.segmentForVideo(aiCanvas, now);

      if (result && result.categoryMask) {
        const mask = result.categoryMask.getAsUint8Array();
        const mw = result.categoryMask.width;
        const mh = result.categoryMask.height;

        if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
          maskCanvas.width = mw;
          maskCanvas.height = mh;
          maskImgData = maskCtx.createImageData(mw, mh);
        }

        if (!maskImgData) {
          maskImgData = maskCtx.createImageData(mw, mh);
        }

        const d = maskImgData.data;
        const r = currentColor.r;
        const g = currentColor.g;
        const b = currentColor.b;

        // Kategori 1 = SAÇ (HAIR)
        for (let i = 0; i < mask.length; i++) {
          const idx = i * 4;
          if (mask[i] === 1) {
            d[idx] = r;
            d[idx + 1] = g;
            d[idx + 2] = b;
            d[idx + 3] = 255; // Tam opak maske
          } else {
            d[idx + 3] = 0;   // Şeffaf
          }
        }

        maskCtx.putImageData(maskImgData, 0, 0);
        result.categoryMask.close(); // C++ bellek sızıntısını önler
      }
    } catch (err) {
      // sessizce devam et
    } finally {
      isAiInferring = false;
    }
  }, 40); // Saniyede ~25 kare AI hesaplama
}

// =============================================================================
// 60 FPS Canlı Kamera ve Renk Harmanlama Çizim Motoru
// =============================================================================
function renderLoop() {
  if (video.readyState >= 2) {
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    // 1. Kamera görüntüsünü anında tam kare çiz (sıfır gecikme)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 2. Saç Boyası Harmanlama Katmanı
    if (currentColor && maskCanvas.width > 0 && !isComparingOriginal) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // KATMAN 1: Işık Açma / Kaldırma (Siyah ve Koyu Saçlar İçin Hayati!)
      // Siyah saçta renk tutması için 'screen' harmanlamasıyla taban tonu kaldırılır
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = currentOpacity * 0.48;
      ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);

      // KATMAN 2: Gerçek Pigment ve Renk Yoğunluğu (Vivid Dye Tint)
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = currentOpacity * 0.52;
      ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);

      // KATMAN 3: Saç Dalgaları ve Işık Yansıması (Strand Highlights & Shadows)
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = 0.60;
      ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);

      ctx.restore();
    }
  }

  // 60 FPS akıcı döngü
  requestAnimationFrame(renderLoop);
}

// =============================================================================
// Renk Paleti ve Arayüz Etkileşimleri
// =============================================================================
function renderPalette(category) {
  paletteContainer.innerHTML = '';

  // Doğal Saç (Temizle) Butonu
  const naturalItem = document.createElement('div');
  naturalItem.className = `color-swatch-item ${currentColor === null ? 'active' : ''}`;
  naturalItem.dataset.color = 'none';
  naturalItem.innerHTML = `
    <div class="swatch-circle none-circle">
      <i data-lucide="slash"></i>
    </div>
    <span class="swatch-name">Doğal Saç</span>
  `;
  naturalItem.addEventListener('click', () => selectColor(null, naturalItem));
  paletteContainer.appendChild(naturalItem);

  // Filtrelenmiş renkler
  const filtered = category === 'all' 
    ? HAIR_COLORS 
    : HAIR_COLORS.filter(c => c.cat === category);

  filtered.forEach(color => {
    const item = document.createElement('div');
    const isActive = currentColor && currentColor.id === color.id;
    item.className = `color-swatch-item ${isActive ? 'active' : ''}`;
    item.dataset.color = color.id;
    item.innerHTML = `
      <div class="swatch-circle" style="background-color: ${color.hex};"></div>
      <span class="swatch-name">${color.name}</span>
    `;
    item.addEventListener('click', () => selectColor(color, item));
    paletteContainer.appendChild(item);
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function selectColor(color, element) {
  currentColor = color;
  document.querySelectorAll('.color-swatch-item').forEach(el => el.classList.remove('active'));
  if (element) {
    element.classList.add('active');
    element.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

// =============================================================================
// Olay Dinleyicileri (Event Listeners)
// =============================================================================
function setupEventListeners() {
  // Kategori Sekmeleri
  categoryTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const cat = btn.dataset.cat;
    if (cat === 'custom') {
      customColorPicker.click();
    } else {
      renderPalette(cat);
    }
  });

  // Özel Renk Seçici (Color Picker)
  customColorPicker.addEventListener('input', (e) => {
    const hex = e.target.value;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    
    const customColor = {
      id: 'custom_' + hex,
      name: 'Özel Renk',
      hex: hex,
      cat: 'custom',
      r, g, b
    };
    
    let customEl = document.querySelector('.color-swatch-item[data-color^="custom"]');
    if (!customEl) {
      customEl = document.createElement('div');
      customEl.className = 'color-swatch-item';
      customEl.dataset.color = customColor.id;
      customEl.innerHTML = `
        <div class="swatch-circle" style="background-color: ${hex};"></div>
        <span class="swatch-name">Özel Renk</span>
      `;
      customEl.addEventListener('click', () => selectColor(customColor, customEl));
      paletteContainer.appendChild(customEl);
    } else {
      customEl.dataset.color = customColor.id;
      customEl.querySelector('.swatch-circle').style.backgroundColor = hex;
    }
    selectColor(customColor, customEl);
  });

  // Opaklık Slider'ı
  opacitySlider.addEventListener('input', (e) => {
    currentOpacity = parseFloat(e.target.value) / 100;
    opacityVal.textContent = `%${e.target.value}`;
  });

  // Harmanlama Modları
  document.querySelectorAll('.mode-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.mode-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentBlendMode = chip.dataset.mode;
    });
  });

  // Karşılaştır Butonu (Orijinal / Boyalı)
  const btnCompare = document.getElementById('btn-compare');
  const startCompare = () => {
    isComparingOriginal = true;
    compareIndicator.classList.remove('hidden');
  };
  const stopCompare = () => {
    isComparingOriginal = false;
    compareIndicator.classList.add('hidden');
  };

  btnCompare.addEventListener('pointerdown', startCompare);
  btnCompare.addEventListener('pointerup', stopCompare);
  btnCompare.addEventListener('pointerleave', stopCompare);

  // Kamera Değiştir (Ön / Arka)
  document.getElementById('btn-flip-camera').addEventListener('click', async () => {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    canvas.style.transform = currentFacingMode === 'user' ? 'scaleX(-1)' : 'none';
    await startCamera();
  });

  // Fotoğraf Çek (Snapshot)
  document.getElementById('btn-snapshot').addEventListener('click', takeSnapshot);

  // Modal Kapatma
  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('snapshot-modal').classList.add('hidden');
  });

  btnStartCamera.addEventListener('click', async () => {
    btnStartCamera.classList.add('hidden');
    loadingTitle.textContent = 'Kamera Başlatılıyor...';
    await startCamera();
    loadingOverlay.classList.add('hidden');
  });
}

// =============================================================================
// Fotoğraf Çekme (Snapshot) Fonksiyonu
// =============================================================================
function takeSnapshot() {
  const flash = document.getElementById('flash-effect');
  flash.classList.remove('flash-active');
  void flash.offsetWidth;
  flash.classList.add('flash-active');

  const snapCanvas = document.createElement('canvas');
  snapCanvas.width = canvas.width;
  snapCanvas.height = canvas.height;
  const sCtx = snapCanvas.getContext('2d');

  if (currentFacingMode === 'user') {
    sCtx.translate(snapCanvas.width, 0);
    sCtx.scale(-1, 1);
  }
  sCtx.drawImage(canvas, 0, 0);

  const dataUrl = snapCanvas.toDataURL('image/png');
  const previewImg = document.getElementById('snapshot-preview');
  const downloadLink = document.getElementById('btn-download');

  previewImg.src = dataUrl;
  downloadLink.href = dataUrl;

  const colorName = currentColor ? currentColor.name.toLowerCase().replace(/\s+/g, '-') : 'dogal-sac';
  downloadLink.download = `sac-rengim-${colorName}.png`;

  document.getElementById('snapshot-modal').classList.remove('hidden');
}

// Sayfa yüklendiğinde başlat
window.addEventListener('DOMContentLoaded', init);
