# 🔌 دليل إحياء وتفعيل جسر الارتباط مع عقل Microsoft 365 Copilot

لإعادة إحياء وتنشيط الجسر الذي يربط بين **نواة القيادة السيادية (Sovereign Commander Console)** وعقل **Microsoft 365 Copilot / Semantic Kernel & Microsoft Graph API**، اتبع الخطوات البرمجية والتكوينية التالية:

---

### 1. إعداد تطبيق Azure AD / Entra ID (App Registration)
1. انتقل إلى [Azure Portal](https://portal.azure.com) ثم **Microsoft Entra ID** > **App registrations** > **New registration**.
2. سمّ التطبيق (مثال: `Sovereign-Copilot-Bridge`).
3. حدد نوع الحسابات (Accounts in this organizational directory only).
4. اضغط **Register** واحصل على:
   - **Application (client) ID** (`AZURE_CLIENT_ID`)
   - **Directory (tenant) ID** (`AZURE_TENANT_ID`)
5. من **Certificates & secrets**، أنشئ **Client Secret** جديد (`AZURE_CLIENT_SECRET`).

---

### 2. الصلاحيات المطلوبة (Microsoft Graph API Permissions)
أضف الصلاحيات التالية (API Permissions) للتطبيق:
- `Files.ReadWrite.All` (لقراءة ومزامنة مستندات OneDrive / SharePoint)
- `Chat.ReadWrite` (للتفاعل مع محادثات Teams و Copilot)
- `User.Read` (لقراءة معلومات المستخدم المصرح له)

---

### 3. إعداد المتغيرات البيئية (`.env`)
أضف المتغيرات التالية إلى ملف البيئة على خادمك أو عبر لوحة التحكم:
```env
AZURE_TENANT_ID=your-tenant-id-here
AZURE_CLIENT_ID=your-client-id-here
AZURE_CLIENT_SECRET=your-client-secret-here
COPILOT_API_ENDPOINT=https://graph.microsoft.com/v1.0/copilot
```

---

### 4. واجهات برمجة التطبيقات للجسر (Copilot Bridge Endpoints)
النظام مزود الآن بنقاط نهاية جاهزة في الخادم (`server.ts`):
- `GET /api/bridge/copilot/status` ➔ التحقق من حالة الاتصال بـ M365 Copilot & Graph API.
- `POST /api/bridge/copilot/sync` ➔ مزامنة كتل التدقيق وسياق النواة مع OneDrive / Microsoft 365.
- `POST /api/bridge/copilot/query` ➔ توجيه استعلامات مباشرة لعقل Copilot والعودة بنتائج تحليلية متكاملة.
