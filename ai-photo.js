
// Health Log v1.0 - AI photo analysis
// This file does not write to Firestore or localStorage.
import { getApps } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

const API_BASE = 'https://health-log-ai.atsushi19820701.workers.dev';
const form = document.getElementById('mealForm');
const preview = document.getElementById('photoPreview');

if (form && preview) {
  const panel = document.createElement('div');
  panel.className = 'wide';
  panel.style.cssText = 'border:1px solid #c7d5d0;border-radius:12px;padding:12px;background:#f5faf8';
  panel.innerHTML = `
    <button type="button" id="aiAnalyzeButton">写真をAI解析</button>
    <p id="aiUsage" class="note" aria-live="polite">AI利用回数を確認中...</p>
    <p id="aiMessage" class="note" role="status" aria-live="polite">写真を選択してAI解析を押してください。</p>
  `;
  const photoStatus = document.getElementById('photoStatus');
  form.insertBefore(panel, photoStatus?.parentElement ?? null);
  const analyzeButton = panel.querySelector('#aiAnalyzeButton');
  const usageLabel = panel.querySelector('#aiUsage');
  const message = panel.querySelector('#aiMessage');
  let analyzing = false;

  function signedInUser() {
    const app = getApps()[0];
    if (!app) throw new Error('Firebaseの初期化が完了していません。');
    const user = getAuth(app).currentUser;
    if (!user) throw new Error('AI解析にはGoogleログインが必要です。');
    return user;
  }

  function showUsage(usage) {
    if (!usage || !Number.isFinite(usage.remaining)) return;
    const reset = usage.resetAt
      ? new Date(usage.resetAt).toLocaleString('ja-JP', {
          timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric',
          hour: '2-digit', minute: '2-digit'
        })
      : '翌日午前4時';
    usageLabel.textContent = `AI解析：残り${usage.remaining}回／${usage.limit}回（更新：${reset}）`;
  }

  async function readResponse(response) {
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    if (data.limit !== undefined) showUsage(data);
    const explanations = {
      401: 'ログイン認証に失敗しました。再ログインしてください。',
      403: 'アクセス元が許可されていません。公開アプリから操作してください。',
      413: '写真のサイズが大きすぎます。',
      429: '本日のAI解析回数が上限に達しました。',
      503: 'AIサービスまたは利用回数管理を利用できません。'
    };
    throw new Error(explanations[response.status] || `APIエラー（${response.status}）：${data.error || '詳細不明'}`);
  }

  async function refreshUsage() {
    try {
      const token = await signedInUser().getIdToken();
      const response = await fetch(`${API_BASE}/usage`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store'
      });
      showUsage(await readResponse(response));
    } catch (error) {
      usageLabel.textContent = `利用回数を取得できません：${error.message}`;
    }
  }

  const app = getApps()[0];
  if (app) {
    onAuthStateChanged(getAuth(app), user => {
      if (user) refreshUsage();
      else usageLabel.textContent = 'Googleログイン後に利用回数を表示します。';
    });
  } else {
    usageLabel.textContent = 'Firebaseの接続を確認してください。';
  }

  analyzeButton.addEventListener('click', async () => {
    if (analyzing) return;
    analyzing = true;
    analyzeButton.disabled = true;
    message.textContent = 'AIで写真を解析しています...';
    try {
      const src = preview.getAttribute('src') || '';
      if (preview.classList.contains('hidden') || !src.startsWith('data:image/jpeg;base64,')) {
        throw new Error('先に食事写真を選択し、プレビューが表示されるまでお待ちください。');
      }
      const imageBase64 = src.slice('data:image/jpeg;base64,'.length);
      if (imageBase64.length > 5592408) throw new Error('写真が4MBを超えています。');
      const token = await signedInUser().getIdToken();
      const response = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg' })
      });
      const result = await readResponse(response);
      if (preview.getAttribute('src') !== src) {
        throw new Error('解析中に写真が変更されました。もう一度解析してください。');
      }
      const metrics = ['calories', 'protein', 'fat', 'carbs'];
      if (!result || metrics.some(key => !Number.isFinite(result[key])) || typeof result.foodName !== 'string') {
        throw new Error('AI解析結果の形式が正しくありません。');
      }
      const setField = (name, value) => {
        const field = form.elements.namedItem(name);
        if (field) field.value = value;
      };
      setField('name', result.foodName);
      setField('kcal', Math.round(result.calories));
      setField('p', Math.round(result.protein * 10) / 10);
      setField('f', Math.round(result.fat * 10) / 10);
      setField('c', Math.round(result.carbs * 10) / 10);
      const details = form.querySelector('details.optional-details');
      if (details) details.open = true;
      showUsage(result.usage);
      const confidence = { low: '低', medium: '中', high: '高' }[result.confidence] || '不明';
      message.textContent = `推定値を入力欄に反映しました（信頼度：${confidence}）。${result.notes || ''} 内容を確認・修正してから「食事を保存」を押してください。`;
    } catch (error) {
      message.textContent = `AI解析できませんでした：${error.message}`;
    } finally {
      analyzing = false;
      analyzeButton.disabled = false;
    }
  });
}
