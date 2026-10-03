# دليل تصدير وتشغيل المشروع على Google Cloud Console & Workstations

> **حالة التحقق (Truth Notice — 2026-10-02، Chain Key `360ea36c28e66d9d`)**
> الجملة التالية كانت ادعاءً بلا قياس. **UNVERIFIED:** لم يُنفَّذ أي نشر فعلي على
> Google Cloud في أي جولة تحقق سابقة، ولا يوجد في هذا المستودع سجل تنفيذ يُثبت ذلك.
> الملفات (`Dockerfile`, `cloudbuild.yaml`, `deploy-to-gcp.sh`, `.dockerignore`)
> موجودة فعلاً — وهذا **مُتحقَّق منه** — لكن "جاهزية النشر" و"النشر بضغطة زر" و"رابط
> إنتاجي مؤمَّن بشهادة SSL" ادعاءات لم تُختبر. لا تُعَدّ دليلاً على نجاح النشر.
> ثبات المنفذ الافتراضي `3000` صحيح: يستمع الخادم على `0.0.0.0:${PORT ?? 3000}`.

تم تجهيز ملفات التكامل مع Google Cloud (Dockerfile، cloudbuild.yaml، deploy-to-gcp.sh، .dockerignore). **جاهزية النشر الفعلية لم تُختبر بالتنفيذ.**

---

## 🛠️ الملفات المضافة للتكامل مع Google Cloud:

1. **`Dockerfile`**: حاوية احترافية جاهزة للنشر والتجميع على Google Cloud Run أو GKE.
2. **`cloudbuild.yaml`**: خطة الأتمتة والنشر التلقائي عبر **Google Cloud Build**.
3. **`deploy-to-gcp.sh`**: نص برمجي للنشر على Cloud Run. **UNVERIFIED — لم يُشغَّل ولا
   مرة واحدة في أي تحقق مسجَّل.** وصفه بـ "بضغطة زر واحدة" و"فوراً" ادعاء غير مقيس.
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
- محاولة تجميع الحاوية ونشرها على Cloud Run.

> **UNVERIFIED:** لم يُنفَّذ هذا السكربت، فلا يمكن ضمان نجاح التفعيل أو النشر، ولا
> يمكن ضمان الحصول على رابط إنتاجي `https://...a.run.app` بشهادة SSL. افترض أنه
> **غير مُختبَر** إلى أن يُشغَّل ويُسجَّل خرجه برمز خروج فعلي.

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
