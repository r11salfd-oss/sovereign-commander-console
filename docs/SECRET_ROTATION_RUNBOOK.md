# دليل تدوير الأسرار — SOVEREIGN COMMANDER CONSOLE

**Chain Key ID:** `360ea36c28e66d9d`
**الجهة:** القائد السيادي الأعلى
**المستودع:** `C:\Users\AA5II\sovereign-commander-console\sovereign-commander-console`
**الفرع:** `sovereign-main` — HEAD `4f9fdd5` — 67 كوميت
**المستودع البعيد:** `https://github.com/r11salfd-oss/sovereign-commander-console.git`
**تاريخ التقرير:** 2026-10-03

---

## ⛔ القاعدة صفر — لا تنفّذ هذا التقرير آلياً

هذا التقرير **تحليل جاهزية وخطة تشغيل**. لم يُسحب أي سر، ولم يُبطَل أي سر.
المحظور منعاً مطلقاً: `revoke` / `delete` / `regenerate` / `invalidate` قبل أن
يكون البديل **موجوداً ومخزَّناً ومُتحقَّقاً منه**. كل خطوة إلغاء في هذا الدليل
موسومة برقم (§). لا تنفذ خطوة إلغاء إلا بعد اجتياز بوابة التحقق المنطبقة عليها.

> **قاعدة الاسترجاع:** إن توقفت أي خطوة عند منتصفها، **توقف**. لا تُكمل، ولا
> "تنهي التنظيف". اترك النقطتينVALID معاً. состоя المزدوجة قابلة للاستخدام؛
> الحالة الفارغة قابلة للقفل.

---

## 1. جدول التعرّض — أين يقف كل سر الآن

**لا تُطبع أي قيمة. الأسماء والأطوال فقط.**

> ### 🚩 قرارٌ صريح مؤجَّل — `AZURE_CLIENT_SECRET` (2026-10-03)
>
> **صدر قرار سيادي: لا تدوير لـ `AZURE_CLIENT_SECRET` حالياً.**
>
> هذا **قرارٌ متَّخَذٌ واعٍ**، لا إهمال ولا نسيان. السبب المُسجَّل: `az` غير مثبَّت على المضيف، ولا يوجد سياق
> مُصادَق، والتدوير يتطلّب خطوةً تفاعلية من مشغّل بشري — ولم يُطلب.
>
> **ما يجب أن يفهمه القارئ التالي:**
> - السرّ **ما زال صالحاً** وقد **لُزِق في محادثة**. التعرّض قائم.
> - هذا السطر موجود **تحديداً** كي لا يُقرأ الوضع كأنه "تمّت المعالجة".
> - **`§` التدوير أدناه صالحٌ ويبقى صالحاً** حين يُطلب. التسلسل آمن: `reset-password --append`
>   (اعتمادان متزامنان، صفر انقطاع) ← تحقّق ← **ثم** احذف القديم. **الإبطال قبل الزرع = قفل ذاتي.**
> - عند استحقاقه: أمرٌ واحد `az login` من مشغّل بشري، ثم §§ أدناه.
>
> **أثر التخفيض المقبول:** أيّ طرف يقرأ ذلك السجلّ يستطيع استنساخ اعتماد Entra هذا.
> **الحدّ الذي يمنع الأسوأ:** لا صلاحية إدارية — التدفق `client_credentials` على
> `audit_ledger` وMicrosoft Graph فقط.

| المفتاح | الموقع | النوع | الحالة | الحرجة |
|---|---|---|---|---|
| `GITHUB_PERSONAL_ACCESS_TOKEN` | `.env:3` (93 حرفاً) | **حرف حرفي** | صالح، لم يُدوَّر | 🔴 حرجة |
| ″ | `Config.Env` للحاوية `bd3f8d4b10ad` | **حرف حرفي** | ساري | 🔴 |
| `AZURE_CLIENT_SECRET` | `.env:10` (40 حرفاً) | **حرف حرفي** | صالح، لم يُدوَّر | 🔴 حرجة |
| ″ | `Config.Env` للحاوية `bd3f8d4b10ad` | **حرف حرفي** | ساري | 🔴 |
| `GitHub_Models_token` | `.env:4` (93) | **حرف حرفي** | ⚠️ **يتيمة — 0 مرجع برمجي** | 🟠 عالية |
| `ANTHROPIC_API_KEY` | `.env:6` (93) | **حرف حرفي** | ⚠️ **يتيمة — 0 مرجع برمجي** | 🟠 عالية |
| `HOST_PROBER_TOKEN` | `.env:12` (43) | **حرف حرفي** | مطلوب ≥32، `server.ts:893` | 🟠 عالية |
| `GEMINI_API_KEY` / `Gemini_API` | `.env:7` / `.env:2` (53) | **حرف حرفي** | `server.ts:485` | 🟠 عالية |
| `COPILOT` | `.env:5` (94) | **حرف حرفي** | غير مُسمّى في الكود | 🟠 عالية |
| `Syncfusion` | `.env:1` (88) | **base64** | ترخيص، يُقرأ في الحاوية | 🟡 متوسطة |
| مفتاح Google API | `firebase-applet-config.json:4` (**متتبَّع في git**) | **حرف حرفي** | مبنيٌّ داخل حزمة JS مُشحونة | 🟡 متوسطة |
| `SOVEREIGN_CLI_TOKEN_FILE` | `.env` غير موجود — منفذ فقط | **مرجع ملف** | ✅ **الشكل الصحيح** | — |
| ″ القيمة | `…\AppData\Roaming\sovereign-commander-console\secrets\cli-token.mount` (43) → `/run/secrets/cli-token` (`:ro`) | **ربط ملف للقراءة فقط** | ✅ | — |

**آلية الوصول إلى الأسرار في وقت التشغيل (مثبتة):** `server.ts:26-40` يحمّل `.env`
عند الإقلاع إن وُجد؛ و`Dockerfile` لا ينسخ `.env` (`.dockerignore` يستثنيه بـ`**/.env`)،
والسرور تُحقن وقت التشغيل عبر `-e` أي **`docker run -e`**. لذلك **كل سر في `.env`
هو أيضاً سر في `Config.Env` للحاوية**.

---

## 2. السرّان في تاريخ git — لا. لا إعادة كتابة.

فُحصت **67 كوميت** بطريقتين مستقلتين: `git log -S` (pickaxe) و`git grep -F` على
كل المراجعات الـ67. النتيجة:

| السرّ | نتائج مسح كل المراجعات | الحكم |
|---|---|---|
| `GITHUB_PERSONAL_ACCESS_TOKEN` | **0** | ✅ ليس في التاريخ |
| `AZURE_CLIENT_SECRET` | **0** | ✅ ليس في التاريخ |

كما أن مسحأنماط البادئات عبر كل المراجعات أعطى **0** لكل من:
`github_pat_`, `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `sk-ant-`, `AKIA`,
`glpat-`, `xoxb-`, `npm_*`, `-----BEGIN`.

### ❌ لا توصية بإعادة كتابة التاريخ. **نطاق الانفجار = صفر.**

بندان ثانويان منخفضان الحدة، **مُبلَّغ عنهما لا مُصلَحان**:

1. **معرّف المستأجر (tenant ID)** — موجود في `server.ts:2946` كقيمة احتياطية
   مكتوبة داخل الكود، ويظهر في 10 مراجعات. هو **معرّف لا يُعدّ credential** — يُعرّف
  Directory ولا يمنح أي صلاحية. خطورة منخفضة.
2. **مفتاح Google API** في `firebase-applet-config.json` — موجود في **كل الـ67
   كوميت** ومبنيٌّ داخل حزمة الإنتاج. مفتاح متصفح Firebase **مصمَّم علناً
   افتراضياً** ومحميٌّ بـAPI Restrictions + Security Rules. **ليس** سر خادم.
   الإجراء الصحيح: قيود المقيّد + حصص، لا إعادة كتابة تاريخ.

---

## 3. المبدأ الحاكم — الترتيب القائم للإلغاء

> **ولّد أولاً. تحقّق. خزّن. عندئذ فقط ألغِ القديم.**

**لماذا هذا هو الترتيب الوحيد الآمن:**

إلغاء سر **إجراء أحادي الاتجاه وغير قابل للتراجع عند المصدر**. لا يوجد "تراجع"
في واجهة GitHub أو Entra — التراجع يعني توليد سر جديد وتحديث كل المستهلكين، أي
إعادة تنفيذ الدورة كاملة تحت ضغط. في المقابل، **توليد سر جديد عملية إضافية
لا تلمس السر القديم إطلاقاً**: النظام القديم يبقى يعمل حتى اللحظة التي تنتهي
فيهاyou تختار فيها الإلغاء.

النتيجة: عند تنفيذ هذا الدليل بالترتيب، **لا توجد أي لحظة واحدة تكون فيها
الأنظمة بلا اعتماد صالح**. أما الترتيب المعكوس (ألغِ ثم ولِّد) فيُدخل فجوةً
قد تمتد من ثوانٍ إلى ما لا نهاية — وأي خطأ بشري داخلها (إغلاق نافذة المتصفح،
فشل `az login`، انتهاء صلاحية جلسة، انقطاع شبكة) يحوّلها إلى **قفل دائم** لا
تُستعاد منه إلا عبر تدوير ثانٍ من الصفر. **الخسارة غير قابلة للتراجع؛ التلقي
بالمؤنَّفة ليس هدفاً.**

الاستثناء الوحيد: إذا اشتُكل تسريبٌ **من مصدر التحكم** ( contributory push أو
تسريب طرف ثالث موثوق) يُلغى السر فوراً حتى لو كلّف ذلك توقفاً مؤقتاً. لا يوجد
such exception في الحالة الحالية.

---

## 4. المسار (أ) — GitHub Personal Access Token

### 4.1 الأدلة على النطاقات الدنيا

الPAT المكشوف من نمط `github_pat_` بطول 93 → **نمط مُصقَّل (fine-grained)**.
النطاقات المطلوبة **مستنتجة من الأدلة، لا مُخمَّنة**:

| النطاق | الدليل المباشر | مطلوب؟ |
|---|---|---|
| `Contents: Read and write` | `origin` = `…/r11salfd-oss/sovereign-commander-console.git`؛ الدفع يتم إلى `sovereign-main` | ✅ نعم |
| `Workflows: Read and write` | كوميتات **`ad4e888`**، **`8b7118b`**، **`2c4c853`**، `3e77264` عدّلت `.github/workflows/**` وتم دفعها. GitHub **يرفض** أي دفع يمسّ `.github/workflows/` بلا هذا النطاق | ✅ نعم |
| `Metadata: Read-only` | إلزامي تلقائياً في النمط المصقَّل | ✅ تلقائي |
| `Issues` / `Pull requests` | `GITHUB_TOOLSETS` مُمرَّر إلى خادم MCP (`scripts/host_prober.ts:256`، `config/servers_center_manifest.json:101`) | ⚠️ فقط إذا كانت أدوات MCP المقابلة مفعَّلة |

**الح scoping الأدنى الآمن:** `Contents: RW` + `Workflows: RW` فقط، على
**مستودع واحد محدَّد** (`sovereign-commander-console`) — لا "كل المستودعات".

### 4.2 ⚠️ حقيقة حاسمة قبل أي شيء

**مسار الدفع لا يمرّ عبر هذا PAT.**

```
$ git config --get-all credential.helper
manager
C:/Users/AA5II/.local/bin/gcm/git-credential-manager.exe
```

مُساعد الاعتماد هو **Git Credential Manager**، والاعتماد محفوظ في **Windows
Credential Manager** تحت الهدف `git:https://r11salfd-oss@github.com` — **مخزن منفصل
تماماً** عن `.env`. بالإضافة إلى ذلك، `gh` نفسه مسجَّل الدخول بـ**رمز OAuth
مختلف تماماً** (`gho_`، 40 حرفاً، مخزَّن في keyring Gh، بنطاقات
`gist`, `read:org`, `repo`, `workflow`).

**النتيجة:** إبطال PAT الموجود في `.env` **لن يقطع مسار الدفع**. إن انقطع الدفع
بعد الإبطال، فالمشكلة ليست PAT — بل اعتماد GCM. **هذا يقلّل الضغط الزمني
ويزيد 폭 النافذة الآمنة.**

### 4.3 الخطوات (بأمان)

**١) ولِّد البديل (لا يُلغي شيئاً):**
`https://github.com/settings/personal-access-tokens/new`
- Resource owner: `r11salfd-oss`
- Repository access: **Only select repositories** → `sovereign-commander-console`
- Repository permissions: `Contents` = Read and write، `Workflows` = Read and write
- **Expiration: قصوى** — لا "بلا انتهاء"
- **أنشئ**

**٢) احفظه فوراً** — انسخه مرّة واحدة، احفظه في مخزن GCM (لا في `.env`):

```powershell
$PAT = Read-Host -AsSecureString "new fine-grained PAT"
$pt  = [Net.NetworkCredential]::new("", $PAT).Password
"protocol=https`nhost=github.com`nusername=r11salfd-oss`npassword=$pt`n`n" |
  & "C:\Users\AA5II\.local\bin\gcm\git-credential-manager.exe" store
Remove-Variable pt,PAT
```

**٣) تحقّق أن البديل يعمل *وأن القديم ما زال يعمل*:**

```powershell
$hdr = @{ Authorization = "Bearer $pt"; Accept = "application/vnd.github+json"
          "X-GitHub-Api-Version" = "2022-11-28" }
(Invoke-RestMethod https://api.github.com/user -Headers $hdr).login
#   المتوقع: r11salfd-oss
(Invoke-RestMethod https://api.github.com/repos/r11salfd-oss/sovereign-commander-console `
   -Headers $hdr).full_name
#   المتوقع: r11salfd-oss/sovereign-commander-console
#   هذا يثبت صلاحية الكتابة على المستودع المحدد، لا القراءة فقط
```

**٤) اختبر الدفع فعلياً (بلا إبقاء):**
```powershell
git fetch origin --dry-run ; git push origin --dry-run sovereign-main
#   المتوقع: dry-run بلا أخطاء. هذا يمرّ عبر GCM لا عبر PAT،
#   لكنه يثبت أن المسار سليم قبل أن تُلغي أي شيء.
```

**٥) انقل خادم MCP إلى PAT الجديد:**
عدّل `scripts/host_prober.ts:256` ليستخدم الاسم الجديد، أو عيّن
`GITHUB_PERSONAL_ACCESS_TOKEN` في بيئة المضيف من GCM بدل `.env`.
**هذا خارج نطاق تدوير PAT** — نفّذه بعد إتمام §4.4.

**٦) ✅ الآن، فقط الآن — ألغِ القديم.**
- الإجراء: زر **Delete** في صفحة PAT، على التوكن القديم فقط.
- **لا تحذف الجديد. لا تلمس `gho_` في keyring Gh. لا تمسّ GCM.**
- **Rollback:** لا رجعة — الاستعادة الوحيدة هي §4.3 من 1. **لهذا بوابة §4.3-3
  إجبارية قبل هذه الخطوة.**

### 4.4 ✅ إلغاء القديم — الخطوة 6

| | |
|---|---|
| **البوابة الإلزامية قبلها** | §4.3-3 (`/user` + `/repos` يعيدان 200) و §4.3-4 (دفع جاف بلا خطأ) |
| **الإجراء** | زر **Delete** في صفحة PAT، على التوكن القديم وحده |
| **ممنوع** | حذف الجديد · مسّ `gho_` في keyring Gh · مسّ GCM |
| **Rollback** | **لا رجعة.** الاستعادة الوحيدة = §4.3 من 1 |

### 4.5 ⛔ إن كنت ستتخطى §4.4

**هذا مقبول وموثَّق.** السر المسرَّب **يبقى صالحاً**. قلبياً مريح، أمنياً
مكشوف. **اكتب التاريخ والسبب، وألغِ متى شئت** — البنية جاهزة وخطوتك 6 موجودة
حرفياً، وتستغرق 60 ثانية.

---

## 5. المسار (ب) — سرّ Service Principal في Entra ID

### 5.1 الأدلة على الاستهلاك

`server.ts:3737-3743` — تدفّق `client_credentials` حقيقي:

```
POST https://login.microsoftonline.com/{AZURE_TENANT_ID}/oauth2/v2.0/token
grant_type=client_credentials
client_id={AZURE_CLIENT_ID}
client_secret={AZURE_CLIENT_SECRET}      ← السطر 3721
scope=https://graph.microsoft.com/.default
```

الصلاحيات المعلنة في `docs/M365_COPILOT_BRIDGE_GUIDE.md:§2`:
`Files.ReadWrite.All`، `Chat.ReadWrite`، `User.Read`.
التطبيق **أحادي المستأجر** ("Accounts in this organizational directory only").

### 5.2 نافذة السرّين المتزامنين — لماذا هي آمنة من القفل

**Entra ID يسمح بسرّين متزامنين لكل Service Principal** (حدّ ثابت، والاثنان
متاحان في نفس اللحظة). هذا هو مفتاح كل العملية:

| اللحظة | السرّ 1 (قديم) | السرّ 2 (جديد) | فجوة اعتماد؟ |
|---|---|---|---|
| قبل أي إجراء | ✅ | — | **لا** |
| بعد **إضافة** الثاني | ✅ | ✅ | **لا** |
| أثناء **التحقق** | ✅ | ✅ | **لا** |
| أثناء **زرع** البديل في `.env` | ✅ | ✅ | **لا** |
| أثناء **إعادة تشغيل الحاوية** | ✅ | ✅ | **لا** |
| عند **حذف** القديم | — | ✅ | **لا** |

**لا توجد لحظة واحدة بلا اعتماد صالح** — منذ أول ضغطة زر حتى آخرها. الخاصية
عدم-الانقطاع **ليست وعداً، بل نتيجة بنيوية**: هي ناتج وجود نقطتين صالحتين
متداخلتين، لا مجهوداً تشغيلياً. عند حذف القديم تختفي النقطة الأولى بينما
الثانية قائمة أصلاً.

### 5.3 ⚠️ أداة التنفيذ: `az` غير مثبَّتة

```
az: NOT FOUND      Az.* PowerShell module: NOT INSTALLED (غير مثبّت)
login.microsoftonline.com  →  HTTP 200   ✅
graph.microsoft.com         →  HTTP 200   ✅
```

`az` CLI ووحدة `Az.*` **غير موجودين على هذا المضيف**. لذلك المسار scenário المتاح
إما **Azure Portal** (دائم، مُوصى) أو **Microsoft Graph REST عبر
`Invoke-RestMethod`** (مُحقَّق: المضيف يصل إلى Graph). `UNVERIFIED` — لم يُنفَّذ
أيٌّ منهما، فالتوثيق أدناه مُركَّب من مواصفات Graph الموثقة ولم يُختبر حيّاً.

### 5.4 الخطوات (بأمان)

**١) ولِّد بلا إلغاء — عبر Portal (مُوصى، مضمون):**

```
https://portal.azure.com
  → Microsoft Entra ID
  → App registrations
  → [اختر التطبيق الذي AZURE_CLIENT_ID الخاص بك]   ← تحقّق بمطابقة المعرّف
  → Certificates & secrets
  → + New client secret
  → Description: "rotation 2026-10-03"
  → Expires: 90 يوماً
  → Add
```
**انسخ قيمة `Value` (وليس `Secret ID`) فوراً** — لا تُعرض مرّة أخرى أبداً.

**أو عبر Graph REST (يعتمد على `az login` أو رمز تسجيل دخول مخصّص):**

```powershell
$tok = <ACCESS-TOKEN-YOU-ALREADY-HAVE>
$h   = @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" }
$body = @{ passwordCredential = @{
            displayName = "rotation 2026-10-03"
            secretText  = (Read-Host -AsSecureString "new secret" |
              ForEach-Object { [Net.NetworkCredential]::new("",$_).Password }) } } | ConvertTo-Json -Depth 5

# POST /v1.0/{tenantId}/oauth2-0/token  ← لا. نقطة النهاية الصحيحة:
# POST https://graph.microsoft.com/v1.0/applications/{appObjectId}/addPassword
Invoke-RestMethod -Method Post -Uri `
  "https://graph.microsoft.com/v1.0/applications/$($env:AZURE_CLIENT_ID)/addPassword" `
  -Headers $h -Body $body
```
> إن لم يكن `az` مثبتاً ولم يكن لديك رمز مخصّص، **استخدم Portal وتجاوز هذه الشيفرة
> كلياً**. لا تُثبّت `az` في نافذة خمس دقائق.

**٢) ✅ تحقّق من أن السرّ الجديد يعمل — بدون لمس القديم:**

```powershell
$cid = (Get-Content .env | Select-String '^AZURE_CLIENT_ID=').Split('=',2)[1]
$ten = (Get-Content .env | Select-String '^AZURE_TENANT_ID=').Split('=',2)[1]
$new = [Net.NetworkCredential]::new("",(Read-Host -AsSecureString "new secret")).Password
$body = @{ grant_type='client_credentials'; client_id=$cid; client_secret=$new
           scope='https://graph.microsoft.com/.default' }

try {
  $r = Invoke-RestMethod -Method Post `
        -Uri "https://login.microsoftonline.com/$ten/oauth2/v2.0/token" `
        -Body $body -ContentType 'application/x-www-form-urlencoded'
  "RESULT: SUCCESS  expires_in=$($r.expires_in)s  token_type=$($r.token_type)"
} catch {
  "RESULT: FAILED  HTTP $([int]$_.Exception.Response.StatusCode)  $($_.Exception.Message)"
}
Remove-Variable new
```

**٣) ازرع البديل في `.env`** — عدّل **القيمة عند `AZURE_CLIENT_SECRET` في السطر
10** فقط. `AZURE_CLIENT_ID` و`AZURE_TENANT_ID` **لا يتغيران أبداً** (معرّفات،
ليست أسراراً). راجع §6.

**٤) أعد إنشاء الحاوية** — انظر §6.2 (**إعادة إنشاء، لا `restart`**).

**٥) تحقّق في وقت التشغيل:**
```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/api/bridge/copilot/sync" `
  -ContentType 'application/json' -Body '{"scope":"audit_ledger"}' |
  Select-Object ok,error,synchronizedItems
#   المتوقع: ok=true ، بلا error
```

### 5.5 ✅ حذف القديم — الخطوة 6

**٦) الآن فقط — احذف السرّ القديم** من نفس صفحة **Certificates & secrets**.

| | |
|---|---|
| **البوابة الإلزامية قبلها** | §5.4-2 (`RESULT: SUCCESS`) **و** §5.4-5 (`ok=true`) |
| **الإجراء (Portal)** | `Certificates & secrets` → زر **Delete** بجوار السرّ القديم **فقط** |
| **الإجراء (Graph)** | `POST https://graph.microsoft.com/v1.0/applications/{appObjectId}/removePassword` بمعرّف السرّ القديم — **لا بالمعرّف الجديد** |
| **ممنوع** | الحذف قبل بوابة §5.4-2 · الحذف معاً · لمس `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` (معرّفات) |
| **Rollback** | **لا رجعة.** ولِّد ثالثاً وأعد §5.4 من 2. |

### 5.6 ⚠️ فخٌّ يجب معرفته قبل الاعتماد على نقطة الفحص

**`GET /api/bridge/copilot/status` لا يتحقق من السرّ إطلاقاً.** الدليل من
`server.ts:3703-3712`:

```ts
const configured = !!process.env.AZURE_CLIENT_ID && !!process.env.AZURE_TENANT_ID;
status: configured ? 'connected' : 'standby_ready'
```

الحقل `AZURE_CLIENT_SECRET` **لا يُقرأ في هذا المسار إطلاقاً**. والنتيجة
المقاسة الآن:

```
GET /api/bridge/copilot/status → HTTP 200
{"status":"connected","clientId":"***configured***", ...}
```

**"connected" هنا تعني "المتغيران موجودان"، لا "السرّ صالح".** لو كان السرّ
منسوخاً إلى الماضي، أو فارغاً، أو منحَ صلاحيةً زائدة، لظلَّ هذا المسار يقول
`connected`. **لا تستخدم هذا المسار كبوابة تحقق أبداً** — استخدم §5.4-2 أو §5.4-5.
هذا بالضبط نوع "البوابة التي يبدو أنها تفرض الأمنية ولا تفرض شيئاً" الذي أزاله
`ci.yml` من `npm audit`.

---

## 6. خريطة إعادة الزرع — أين تستقر القيمة الجديدة

### 6.1 المفاتيح التي تتغيّر — المسار الصحيح

| المفتاح | الشكل الصحيح | الحالة الحالية (حرفي) |
|---|---|---|
| `AZURE_CLIENT_SECRET` | `AZURE_CLIENT_SECRET_FILE=/run/secrets/azure-client-secret` | ❌ الحالي |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | GCM (Windows Credential Manager) | ❌ الحالي في `.env` |
| `SOVEREIGN_CLI_TOKEN` | **bind-mounted file** — **جاهز بالفعل** | — |
| `HOST_PROBER_TOKEN` | `HOST_PROBER_TOKEN_FILE` ← `…\secrets\host-prober-token.txt` (موجود) | ❌ الحالي |
| `GitHub_Models_token` | **احذفه** — 0 مرجع | ❌ |
| `ANTHROPIC_API_KEY` | **احذفه** — 0 مرجع | ❌ |

### 6.2 ⚠️ إعادة تشغيل الحاوية: `restart` **لا تكفي**

**متغيرات البيئة مُثبَّتة عند إنشاء الحاوية ولا تتغير بعدها.** `docker restart`
يعيد تشغيل **نفس** `Config.Env`. لتطبيق قيمة جديدة **يجب إعادة إنشاء الحاوية**:

```powershell
$Repo = "C:\Users\AA5II\sovereign-commander-console\sovereign-commander-console"
$Sec  = "C:\Users\AA5II\AppData\Roaming\sovereign-commander-console\secrets"

docker rm -f sovereign-commander-console
docker run -d --name sovereign-commander-console `
  --restart unless-stopped `
  -p 127.0.0.1:3000:3000 `
  -v "${Repo}\data:/app/data" `
  -v "${Sec}\cli-token.mount:/run/secrets/cli-token:ro" `
  --env-file "${Repo}\.env" `
  -e SOVEREIGN_CLI_TOKEN_FILE=/run/secrets/cli-token `
  sovereign-commander-console:latest

# انتظر الصحة، ثم تحقق فعلياً من داخل الحاوية:
docker exec sovereign-commander-console node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"
```

**الشكل مُستعاد من `docker inspect`** (أسماء فقط، بلا قيم):
`image=sovereign-commander-console:latest` · `user=node` · `workdir=/app` ·
`entrypoint=["docker-entrypoint.sh"]` · `cmd=["node","dist/server.cjs"]` ·
`restart=unless-stopped` · `net=bridge` · `3000/tcp → 127.0.0.1:3000` ·
`readonlyRootfs=false` · Mounts: `data` (rw) + `cli-token.mount` (ro).

> **فجوة تشغيلية موثّقة:** أمر `docker run` **غير مسجَّل في أي ملف بالمستودع**
> (تم البحث في `docs/*.md`, `.vscode/tasks.json`, `deploy-to-gcp.sh`,
> `README.md`, `AGENTS.md`, `OPENCODE.md` — صفر نتيجة). الكتلة أعلاه هي
> الاستعادة من `docker inspect`. **سجّلها في `docs/` بعد الإتمام.**

### 6.3 `SOVEREIGN_CLI_TOKEN_FILE` — مسار يختلف كلياً

**هذا ليس متغير بيئة، بل bind-mount للقراءة فقط.** الإجراء مختلف جذرياً:

| | متغير بيئة | ربط ملف |
|---|---|---|
| مكان القيمة | `Config.Env` | نظام الملفات |
| الصلاحية عند التعديل | لا شيء | فوري داخل الحاوية |
| يتطلب إعادة إنشاء؟ | **نعم** | **لا** — يُقرأ عند كل طلب |
|.rotate | تعديل `.env` + `docker rm/run` | كتابة ملف + `docker restart` |

```powershell
$new = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")   # 64
$new | Set-Content "C:\Users\AA5II\AppData\Roaming\sovereign-commander-console\secrets\cli-token.mount" -NoNewline
docker restart sovereign-commander-console      # لا حاجة لإعادة إنشاء
```

⚠️ **`.mount` هو الملف المُربط**، وليس `cli-token.txt` (كلاهما موجود بطول 43).
حرّك **الملف المُربط تحديداً** وإلا تغيّر شيء ولم يتغيّر السلوك.

---

## 7. أوامر التحقق النهائية — الحالة المطلوبة بعد التدوير

```powershell
Set-Location "C:\Users\AA5II\sovereign-commander-console\sovereign-commander-console"

# ① المدقّق الأمني — يجب أن يخرج 0
npx tsx scripts/verify_secret_hygiene.ts ; $LASTEXITCODE      # الهدف: 0

# ② النمط الحرفي من `.env` يجب ألا يعود
git grep -n "SOVEREIGN_CLI_TOKEN=" -- '.env*' '.github/workflows/*'   # المتوقع: 0 سطر

# ③ لا سر في تاريخ git (يجب أن يبقى صفراً بعد كل التدوير)
git log --all -S"<القيمة_الجديدة>" --oneline ; git log --all -S"<القيمة_القديمة>" --oneline
#   المتوقع: كلاهما فارغ. (القيم مُدخلة يدوياً ولا تُطبع في السجل.)

# ④ الحاوية تحمل القيمة الجديدة
docker inspect --format '{{json .Config.Env}}' sovereign-commander-console |
  ConvertFrom-Json | ForEach-Object { ($_ -split '=',2)[0] }   # أسماء فقط

# ⑤ الصحة + جسر Graph
Invoke-WebRequest http://127.0.0.1:3000/api/health -UseBasicParsing | Select-Object StatusCode   # 200
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/api/bridge/copilot/sync" `
  -ContentType 'application/json' -Body '{"scope":"audit_ledger"}' |
  Select-Object ok,error,synchronizedItems                                                    # ok=True

# ⑥ لا سر في الـ bundle المشحون
docker exec sovereign-commander-console sh -lc 'grep -rcE "github_pat_|ghp_|sk-ant-|-----BEGIN" /app/dist 2>/dev/null | grep -v ":0$"'
#   المتوقع: لا مخرجات
```

---

## 8. شكل الفشل — ماذا يعني كل مخرج

| المخرج | التشخيص | الإجراء |
|---|---|---|
| `§5.4-2` → `RESULT: FAILED HTTP 401` | السر الجديد خاطئ أو **منسوخ بـ`AZURE_CLIENT_SECRET`** قبلTrial | أعد التوليد؛ **لا تحذف القديم بعد** |
| `RESULT: FAILED HTTP 400` | النص مُشوَّه (سطر جديد، مسافة) | انسخ من Portal بدل النسخ اليدوي |
| `§5.4-5` → `ok=false, error=BRIDGE_NOT_CONFIGURED` | الحاوية أُعيد إنشاؤها **قبل** تعديل `.env` | أعد §6.2 **بعد** التعديل |
| `§5.4-5` → HTTP 502 مع `AADSTS7000215` | السر صحيح لكن **Application permissions غير مُوافقة** | موافقة إدارية على `Files.ReadWrite.All` / `Chat.ReadWrite` |
| §7① → `FAIL(n)` | ما زال في Config.Env أو `.env` حرفاً حرفياً | §6.1 |
| §7② → سطر واحد | ارتداد للـ raw variant | احذف السطر كلياً؛ **لا تفرغه** |
| §7⑤ → HTTP 200 لكن `ok=false` | انظر الصفوف أعلاه | — |
| `docker exec` → `Error: No such container` | الحاوية حُذفت ولم يُعَد إنشاءها | §6.2 فوراً |
| بوابة §4.4 فشلت **بعد** الإلغاء | نافذة الثقة كانت ضيقة | ولِّد PAT جديداً فوراً — لا تنتظر |

---

## 9. خطة التراجع — لكل خطوة

| الخطوة | التراجع |
|---|---|
| §4.1 ولِّد PAT | `Delete` من صفحة PATs. لا أثر. |
| §4.2–4.3 خزّن وتحقّق | لا تراجع لازم. يوجد سرّان. |
| §4.4 اختبر دفعاً | لا أثر. |
| §4.4 **ألغِ** | ⚠️ **لا رجعة.** الاستعادة = ولِّد جديد + أعد §4.3-4. **لهذا البوابة قبل الإلغاء إجبارية.** |
| §5.4-1 أضف سرّ Entra الثاني | `Remove` من Certificates & secrets. لا أثر. |
| §5.4-2 تحقّق | لا أثر. |
| §5.4-3 ازرع في `.env` | استعد القيمة القديمة (لديك نافذة). |
| §5.4-4 أعد إنشاء الحاوية | `docker start` سليمة؛ نافذة `docker ps -a` محفوظة. |
| §5.5 **احذف** | ⚠️ **لا رجعة.** الاستعادة = ولِّد ثالثاً + §5.4-2. |
| §6.2 إعادة إنشاء الحاوية | الحاوية القديمة ما زالت في `docker ps -a` بـ`restart=unless-stopped` → عادت من تلقاء نفسها إن أُزيلت. |
| §6.3 تدوير ملف الوسم | احتفظ بالنسخة القديمة، `Set-Content`، `docker restart`. |

---

## 10. المخاطر المتبقية — بعد تنفيذ كل ما سبق

| # | الخطر | الأثر | التصنيف |
|---|---|---|---|
| R1 | **السرّان المسرَّبان يبقيان صالحين** إن تُخطّيَّ خطوتي الإلغاء | مهاجم يحتفظ بنسخة منهما فيصل دائماً | 🔴 **مقبول وموثَّق**: نافذة خطوة واحدة معدودة |
| R2 | `GitHub_Models_token` + `ANTHROPIC_API_KEY` — **يتيمتان، 0 مرجع** | سطح تعرّض بلا فائدة | 🟠 **احذفهما من `.env`** — لا تدوير مطلوب، بل حذف |
| R3 | 9 أسرار في `Config.Env` — يقرأها `docker inspect` كاملاً | تسريب عبر تقارير الأعطال وسجلّات منسّقي الحاويات | 🟠 يُحل بالتحويل إلى `*_FILE` كاملة (§6.1) |
| R4 | **لا `docker run` مسجَّل** | الإعادة اليدوية عرضة للخطأ | 🟠 سجّل §6.2 في `docs/` |
| R5 | **`.gitignore` لا يغطي `*.token` ولا `secrets/`** (مثبت: `git check-ignore` → exit 1) | `git add .` واحد يكفي | 🟠 أضف القاعدتين |
| R6 | مفتاح Google API في التاريخ + في الـ bundle | استهلاك حصة، إساءة استخدام | 🟡 قيود المقيّد + حصص |
| R7 | `HOST_PROBER_TOKEN` هو نفسه ملف مُسطَّح (`.txt`) داخل `AppData` | قابل للنسخ | 🟡 chmod/ACL مُقيَّد |
| R8 | `secrets\cli-token.txt` **غير مُربط** ويعمل نسخة من السرّ | تكرار بلا داعٍ | 🟡 احذفه |

---

## 11. `UNVERIFIED` — ما لم أُنفِّذه ولم أستطع

| البند | السبب |
|---|---|
| §5.3 شيفرة Graph REST | `az` غير مثبّت؛ لم يُنفَّذ طلب `addPassword` حيّاً. مُركَّب من مواصفة Graph |
| §4.3 اختبار `/user` بـPAT | لم أُنشئ PAT جديداً (منعاً للتعريض) |
| §5.4-2 `POST /token` بـsecret | لم أُنفّذ (سأحرق السرّ المسرَّب في السجل) |
| §5.4-5 `/api/bridge/copilot/sync` | لم يُنفَّذ؛ سيمرّ بـ**السرّ المسرَّب** ويسجّله الخادم |
| `npx tsc --noEmit` → **0** | ❌ ع��يد 2. خطأ واحد: `src/services/systemTelemetryService.ts:470` — `missing lastChecked`. الملف **معدَّل غير مُودَع من وكيل متزامن** (`+197/−20`)، وقد أضاف `lastChecked` إلى 23 موضعاً وأغفل موضعاً واحداً. **ملف خارج نطاق ملكيتي — لم ألمسه.** ملفّي `scripts/verify_secret_hygiene.ts`: **0 أخطاء**. |
| `PAT-GOOGLE` على الملف الحي | Xpositively مُثبت: `AIza` بطول 39، ومطابقة `sha256[:16]=40cca65fdf3b007f` على **كلا الجانبين** (المضيف + `/app/dist/assets/index-BXCZ7WvB.js`) |

---

## 12. خلاصة القيادة

1. **لا سرٌّ في تاريخ git. لا إعادة كتابة. الانفجار = صفر.**
2. **الترتيب: ولِّد → تحقّق → خزّن → ألغِ.** العكس قفل.
3. **مسار الدفع لا يمرّ بـ`.env` PAT** (GCM + `gh` `gho_` منفصلان) → ضغط أقل.
4. **نافذة سرّين في Entra** تجعل الإلغاء عديم الانقطاع بنيوياً.
5. **لا تثق بـ`/api/bridge/copilot/status`** — فحص حضور، لا فحص اعتماد.
6. **`docker restart` لا يحمّل `.env` جديداً** — الحاوية يجب إعادة إنشاؤها.
7. **الوقت المتاح سعري:** خطوتان Only بأزرار في بوابة، ~60 ثانية لكل منهما.