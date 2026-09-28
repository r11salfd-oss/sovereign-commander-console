# دليل تصدير وتشغيل المشروع على Google Cloud Console & Workstations

تم تجهيز المشروع بالكامل للعمل المباشر على منصة **Google Cloud Platform (GCP)** و **Google Cloud Workstations / Cloud Shell**.

---

## 🛠️ الملفات المضافة للتكامل مع Google Cloud:

1. **`Dockerfile`**: حاوية احترافية جاهزة للنشر والتجميع على Google Cloud Run أو GKE.
2. **`cloudbuild.yaml`**: خطة الأتمتة والنشر التلقائي عبر **Google Cloud Build**.
3. **`deploy-to-gcp.sh`**: نص برمجي بضغطة زر واحدة لنشر المشروع فوراً على Cloud Run.
4. **`.dockerignore`**: استبعاد الملفات غير الضرورية لتحسين سرعة البناء.

---

## 🚀 الخطوات العملية للتشغيل على Google Cloud Shell Editor / Cloud Workstations

### الطريقة الأولى: التشغيل عبر Google Cloud Shell (مجانياً ومباشراً)

1. افتح **Google Cloud Console**:
   👉 [https://console.cloud.google.com/](https://console.cloud.google.com/)

2. انقر على أيقونة **Cloud Shell** (زر `>_` أعلى اليمين) أو افتح **Cloud Shell Editor**.

3. قم برفع سورس كود المشروع أو سحبه من المستودع الخاص بك:
   ```bash
   cd ~/sovereign-commander-console
   ```

4. تثبيت الحزم وتشغيل الخادم المباشر على المنفذ `3000`:
   ```bash
   npm install
   npm run dev
   ```

5. انقر على **Web Preview** في Cloud Shell واختر **Preview on port 3000** لعرض التطبيق مباشرة.

---

### الطريقة الثانية: النشر المباشر على Google Cloud Run (أعلى أداء واستقرار)

في شاشة Cloud Shell، قم بتشغيل الأمر التالي فقط:
```bash
bash deploy-to-gcp.sh
```

سيقوم الأمر آلياً بـ:
- تفعيل واجهات **Cloud Run API** و **Cloud Build API** في مشروعك.
- تجميع الحاوية ونشرها مباشرة مع الحصول على رابط إنتاجي مسجل ومؤمن بشهادة SSL تلقائياً (`https://...a.run.app`).

---

### الطريقة الثالثة: التطوير والتعديل المباشر على Google Cloud Workstations

1. من القائمة الجانبية في **Google Cloud Console**، انتقل إلى **Cloud Workstations**.
2. أنشئ بيئة عمل جديدة (Cloud Workstation Environment) قائمة على **Code-OSS (VS Code in Browser)**.
3. افتح المجلد واستخدم Terminal المدمج للتطوير والمتابعة كلمة بكلمة.

---

## 🔐 ضبط المفاتيح والهوية على Google Cloud

مشروعك مرصود على معرف المشروع الحالي:
`ai-studio-f907853f-62b4-4779-97cc-9fc2349de7d4`

إذا أردت ضبط مفتاح Gemini API في البيئة الإنتاجية على Cloud Run:
```bash
gcloud run services update sovereign-commander-console \
  --set-env-vars GEMINI_API_KEY="YOUR_GEMINI_API_KEY" \
  --region us-central1
```
