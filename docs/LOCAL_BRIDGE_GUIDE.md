# 🌉 دليل إحياء وربط الجسر بين جهازك المحلي و Google AI Studio

لإعادة إحياء وربط الجسر البرمجي والمستودع بين جهازك المحلي (Local Machine) وبيئة Google AI Studio، يمكنك اتباع إحدى الطرق التالية بكل سهولة:

---

### 🌐 الطريقة الأولى: المزامنة عبر Git (موصى بها للتطوير المستمر)

بما أن المستودع المحلي الآن مجهز بنظام Git، يمكنك ربطه بمستودع على GitHub أو GitLab ومزامنة التعديلات في اتجاهين:

1. **إنشاء مستودع جديد على GitHub** (مثال: `sovereign-commander-console`).
2. **ربط المستودع المحلي في بيئة AI Studio:**
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/sovereign-commander-console.git
   git branch -M main
   git push -u origin main
   ```
3. **على جهازك المحلي:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/sovereign-commander-console.git
   cd sovereign-commander-console
   npm install
   npm run dev
   ```

---

### 💻 الطريقة الثانية: النقل اليدوي أو السحابي الفوري

إذا أردت العمل محلياً فوراً:
1. قم بتحميل سورس كود المشروع من خيارات القائمة في Google AI Studio.
2. فك الضغط على جهازك المحلي.
3. فتح المشروع عبر **VS Code** أو أي محرر أكواد.
4. تشغيل الأوامر المحلية:
   ```bash
   npm install
   npm run dev
   ```

---

### ⚡ الطريقة الثالثة: تشغيل الجسر السحابي المباشر عبر Cloud Shell
إذا أردت تشغيل بيئة العمل المتكاملة سحابياً ومحلياً معاً:
1. افتح **Google Cloud Shell** في متصفحك.
2. شغل الخادم المحلي:
   ```bash
   npm run dev
   ```
   > **تصحيح (2026-10-02):** النصيحة القديمة كانت `npm run dev -- --host 0.0.0.0 --port 3000`.
   > هذا **غير صحيح** لبنية المشروع الحالية: سكربت `dev` هو
   > `cross-env NODE_OPTIONS="..." tsx server.ts` — أي خادم Express، لا Vite.
   > الخيارات `--host/--port` تُمرَّر إلى `tsx` ولا يقرأها `server.ts`، فهي لا تُغيّر شيئًا.
   > والأمر لا يحتاجها أصلاً: `server.ts` يستمع على `0.0.0.0:${PORT ?? 3000}`،
   > أي أن الربط العام والمنفذ 3000 **مُتحقَّق منه في الكود**.
3. استخدم أداة مثل `cloudflared` أو `ngrok` لإنشاء نفق آمن (Tunnel) للوصول إلى بيئة التطوير من جهازك المحلي مباشرة دون الحاجة لنقل الملفات.
