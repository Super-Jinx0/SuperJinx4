// Lightweight UI translation. The source language of the app is Persian (fa); every other language is applied by
// translating UI text in the DOM (exact phrases first, then known fragments), so dynamic strings work too.
// User content (chat messages, code, memories) is never touched.

export const LANGS = {
  fa: { name: 'فارسی', dir: 'rtl', locale: 'fa-IR' },
  en: { name: 'English', dir: 'ltr', locale: 'en-US' },
  ar: { name: 'العربية', dir: 'rtl', locale: 'ar-u-nu-latn' },
  tr: { name: 'Türkçe', dir: 'ltr', locale: 'tr-TR' },
};

let lang = 'fa';
try { const s = localStorage.getItem('jinx_lang'); if (LANGS[s]) lang = s; } catch {}
export const getLang = () => lang;
export const langInfo = () => LANGS[lang];
export function setLang(l) {
  if (!LANGS[l]) return;
  try { localStorage.setItem('jinx_lang', l); } catch {}
  location.reload();
}

// [fa, en, ar, tr]
const T = [
  ['نشست منقضی شده', 'Session expired', 'انتهت الجلسة', 'Oturum süresi doldu'],
  ['خطا (', 'Error (', 'خطأ (', 'Hata ('],
  ['تایید', 'Confirm', 'تأكيد', 'Onayla'],
  ['انصراف', 'Cancel', 'إلغاء', 'İptal'],
  ['ذخیره', 'Save', 'حفظ', 'Kaydet'],
  ['امروز', 'Today', 'اليوم', 'Bugün'],
  ['دیروز', 'Yesterday', 'أمس', 'Dün'],
  ['هفته اخیر', 'Last 7 days', 'آخر 7 أيام', 'Son 7 gün'],
  ['قدیمی‌تر', 'Older', 'أقدم', 'Daha eski'],
  ['جینکس، پنل خصوصی هوش مصنوعی', 'Jinx, your private AI panel', 'جينكس، لوحة الذكاء الاصطناعي الخاصة بك', 'Jinx, özel yapay zeka panelin'],
  ['رمز عبور', 'Password', 'كلمة المرور', 'Parola'],
  ['ورود', 'Sign in', 'تسجيل الدخول', 'Giriş yap'],
  ['گفتگوی جدید', 'New chat', 'محادثة جديدة', 'Yeni sohbet'],
  ['گفتگو', 'Chat', 'المحادثة', 'Sohbet'],
  ['حافظه', 'Memory', 'الذاكرة', 'Hafıza'],
  ['اتصال', 'Connection', 'الاتصال', 'Bağlantı'],
  ['مصرف', 'Usage', 'الاستهلاك', 'Kullanım'],
  ['جینکس', 'Jinx', 'جينكس', 'Jinx'],
  ['در حال بررسی', 'Checking', 'جارٍ الفحص', 'Kontrol ediliyor'],
  ['API وصل نیست', 'API not connected', 'واجهة API غير متصلة', 'API bağlı değil'],
  ['گزینه‌ها', 'Options', 'خيارات', 'Seçenekler'],
  ['تغییر نام گفتگو', 'Rename chat', 'إعادة تسمية المحادثة', 'Sohbeti yeniden adlandır'],
  ['تغییر نام', 'Rename', 'إعادة تسمية', 'Yeniden adlandır'],
  ['حذف گفتگو', 'Delete chat', 'حذف المحادثة', 'Sohbeti sil'],
  ['این گفتگو برای همیشه حذف شود؟', 'Delete this chat permanently?', 'هل تريد حذف هذه المحادثة نهائيًا؟', 'Bu sohbet kalıcı olarak silinsin mi?'],
  ['حذف کلید', 'Remove key', 'إزالة المفتاح', 'Anahtarı kaldır'],
  ['حذف', 'Delete', 'حذف', 'Sil'],
  ['یک سایت خفن بساز', 'Build a stunning website', 'ابنِ موقعًا مذهلًا', 'Muhteşem bir site yap'],
  ['یک وب‌سایت لندینگ فوق‌العاده مدرن و لوکس برای برند من طراحی کن (انیمیشن‌های نرم، کاملا ریسپانسیو، با تم تیره و روشن). همه فایل‌ها را کامل بده تا پیش‌نمایش زنده ببینم.', 'Design an ultra-modern, luxurious landing page for my brand (smooth animations, fully responsive, dark and light theme). Give me every file in full so I can see the live preview.', 'صمّم صفحة هبوط عصرية وفاخرة جدًا لعلامتي التجارية (حركات ناعمة، متجاوبة بالكامل، مظهر داكن وفاتح). أعطني كل الملفات كاملة لأرى المعاينة المباشرة.', 'Markam için ultra modern ve lüks bir açılış sayfası tasarla (yumuşak animasyonlar, tam responsive, koyu ve açık tema). Canlı önizleme görebilmem için tüm dosyaları eksiksiz ver.'],
  ['تصویر سینمایی', 'Cinematic image', 'صورة سينمائية', 'Sinematik görsel'],
  ['یک تصویر سینمایی خیره‌کننده از شهری در آینده زیر باران نئونی در شب', 'A breathtaking cinematic image of a futuristic city at night under neon rain', 'صورة سينمائية خلابة لمدينة مستقبلية في الليل تحت مطر النيون', 'Gece, neon yağmur altında fütüristik bir şehrin nefes kesici sinematik görseli'],
  ['ساخت ویدیو ·', 'Video ·', 'إنشاء الفيديو ·', 'Video ·'],
  ['ساخت ویدیو ناموفق بود', 'Video generation failed', 'فشل إنشاء الفيديو', 'Video oluşturulamadı'],
  ['ساخت ویدیو', 'Create video', 'إنشاء فيديو', 'Video oluştur'],
  ['یک ویدیوی کوتاه سینمایی از طلوع خورشید روی کوه‌های مه‌آلود', 'A short cinematic video of the sun rising over misty mountains', 'فيديو سينمائي قصير لشروق الشمس فوق جبال يكسوها الضباب', 'Sisli dağların üzerinde güneşin doğuşunu gösteren kısa sinematik video'],
  ['ربات تلگرام', 'Telegram bot', 'بوت تيليجرام', 'Telegram botu'],
  ['یک ربات تلگرام با Node.js و دستورات استقرار روی Railway بنویس.', 'Write a Telegram bot with Node.js and Railway deployment steps.', 'اكتب بوت تيليجرام بـ Node.js مع خطوات النشر على Railway.', 'Node.js ile bir Telegram botu ve Railway kurulum adımlarını yaz.'],
  ['ساخت تصویر', 'Create image', 'إنشاء صورة', 'Görsel oluştur'],
  ['خودکار', 'Auto', 'تلقائي', 'Otomatik'],
  ['فوتورئال', 'Photoreal', 'واقعي', 'Fotogerçekçi'],
  ['سینمایی', 'Cinematic', 'سينمائي', 'Sinematik'],
  ['سه‌بعدی', '3D', 'ثلاثي الأبعاد', '3B'],
  ['تصویرسازی', 'Illustration', 'رسم توضيحي', 'İllüstrasyon'],
  ['انیمه', 'Anime', 'أنمي', 'Anime'],
  ['لوگو', 'Logo', 'شعار', 'Logo'],
  ['محصول', 'Product', 'منتج', 'Ürün'],
  ['نقاشی', 'Painting', 'لوحة فنية', 'Resim'],
  ['نسبت', 'Ratio', 'النسبة', 'Oran'],
  ['سبک', 'Style', 'النمط', 'Stil'],
  ['تعداد', 'Count', 'العدد', 'Adet'],
  ['بهبود هوشمند پرامپت', 'Smart prompt boost', 'تحسين ذكي للوصف', 'Akıllı istem geliştirme'],
  ['مدت', 'Length', 'المدة', 'Süre'],
  ['انتخاب مدل', 'Choose model', 'اختر النموذج', 'Model seç'],
  ['تصویر را توصیف کن (فارسی هم می‌شود)', 'Describe the image (any language works)', 'صف الصورة (أي لغة تصلح)', 'Görseli tarif et (her dil olur)'],
  ['ویدیو را توصیف کن', 'Describe the video', 'صف الفيديو', 'Videoyu tarif et'],
  ['پیامت را بنویس', 'Write your message', 'اكتب رسالتك', 'Mesajını yaz'],
  ['سلام', 'Hello', 'مرحبًا', 'Merhaba'],
  ['امروز چه بسازیم؟', 'What shall we build today?', 'ماذا سنبني اليوم؟', 'Bugün ne inşa edelim?'],
  ['دانلود تصویر', 'Download image', 'تنزيل الصورة', 'Görseli indir'],
  ['دانلود ویدیو', 'Download video', 'تنزيل الفيديو', 'Videoyu indir'],
  ['دانلود صدا', 'Download audio', 'تنزيل الصوت', 'Sesi indir'],
  ['صدا ندارد', 'No audio track', 'لا يوجد صوت', 'Ses yok'],
  ['نمایش کامل', 'View full size', 'عرض بالحجم الكامل', 'Tam boyut göster'],
  ['دانلود ZIP', 'Download ZIP', 'تنزيل ZIP', 'ZIP indir'],
  ['دانلود دیتابیس', 'Download database', 'تنزيل قاعدة البيانات', 'Veritabanını indir'],
  ['دانلود', 'Download', 'تنزيل', 'İndir'],
  ['فایل آماده', 'files ready', 'ملفات جاهزة', 'dosya hazır'],
  ['خاطره در این پاسخ استفاده شد', 'memories used in this reply', 'ذكريات استُخدمت في هذا الرد', 'anı bu yanıtta kullanıldı'],
  ['کپی شد', 'Copied', 'تم النسخ', 'Kopyalandı'],
  ['کپی', 'Copy', 'نسخ', 'Kopyala'],
  ['تولید دوباره', 'Regenerate', 'إعادة التوليد', 'Yeniden üret'],
  ['توقف', 'Stop', 'إيقاف', 'Durdur'],
  ['ارسال به مدل تصویر', 'Sending to the image model', 'الإرسال إلى نموذج الصور', 'Görsel modeline gönderiliyor'],
  ['ارسال درخواست ویدیو', 'Sending video request', 'إرسال طلب الفيديو', 'Video isteği gönderiliyor'],
  ['ارسال', 'Send', 'إرسال', 'Gönder'],
  ['حداکثر ۸ پیوست', 'Up to 8 attachments', 'حتى 8 مرفقات', 'En fazla 8 ek'],
  ['بیش از ۲۵ مگابایت است', 'is larger than the upload limit', 'أكبر من حد الرفع', 'yükleme sınırından büyük'],
  ['پیوست فایل', 'Attach file', 'إرفاق ملف', 'Dosya ekle'],
  ['پیوست تصویر', 'Attach image', 'إرفاق صورة', 'Görsel ekle'],
  ['پیوست‌ها هنوز در حال بارگذاری‌اند', 'Attachments are still uploading', 'المرفقات قيد الرفع', 'Ekler hâlâ yükleniyor'],
  ['در حال آپلود', 'Uploading', 'جارٍ الرفع', 'Yükleniyor'],
  ['فایل‌های آپلود', 'Uploaded files', 'الملفات المرفوعة', 'Yüklenen dosyalar'],
  ['فایل', 'files', 'ملفات', 'dosya'],
  ['ثانیه', 'sec', 'ثانية', 'sn'],
  ['مگابایت', 'MB', 'ميغابايت', 'MB'],
  ['روز', 'days', 'يوم', 'gün'],
  ['دسکتاپ', 'Desktop', 'سطح المكتب', 'Masaüstü'],
  ['موبایل', 'Mobile', 'الجوال', 'Mobil'],
  ['پیش‌نمایش زنده سایت', 'Live site preview', 'معاينة الموقع المباشرة', 'Canlı site önizlemesi'],
  ['پیش‌نمایش زنده', 'Live preview', 'معاينة مباشرة', 'Canlı önizleme'],
  ['در حال آماده‌سازی', 'Getting ready', 'جارٍ التحضير', 'Hazırlanıyor'],
  ['مراحل فکر کردن', 'Thinking steps', 'خطوات التفكير', 'Düşünme adımları'],
  ['در حال ساخت پروژه', 'Building the project', 'جارٍ بناء المشروع', 'Proje oluşturuluyor'],
  ['از', 'of', 'من', '/'],
  ['خط', 'lines', 'سطر', 'satır'],
  ['اول API را در بخش «اتصال» وصل کن', 'First connect your API in “Connection”', 'اربط واجهة API أولًا من قسم «الاتصال»', 'Önce “Bağlantı” bölümünden API’ni bağla'],
  ['اول API را وصل کن تا گفتگو شروع شود.', 'Connect your API first to start chatting.', 'اربط واجهة API أولًا لبدء المحادثة.', 'Sohbete başlamak için önce API’ni bağla.'],
  ['با مدل تصویر ساخته می‌شود', 'Will be created with the image model', 'سيُنشأ بنموذج الصور', 'Görsel modeliyle oluşturulur'],
  ['با مدل ویدیو ساخته می‌شود', 'Will be created with the video model', 'سيُنشأ بنموذج الفيديو', 'Video modeliyle oluşturulur'],
  ['برای ساخت عکس، در «اتصال» یک مدل تصویر انتخاب کن', 'To create images, choose an image model in “Connection”', 'لإنشاء الصور اختر نموذج صور من «الاتصال»', 'Görsel için “Bağlantı”dan bir görsel modeli seç'],
  ['برای ساخت ویدیو، در «اتصال» مدل ویدیو را وارد کن', 'To create videos, enter a video model in “Connection”', 'لإنشاء الفيديو أدخل نموذج فيديو في «الاتصال»', 'Video için “Bağlantı”ya bir video modeli gir'],
  ['یک مدل تصویر انتخاب کن', 'Choose an image model', 'اختر نموذج صور', 'Bir görsel modeli seç'],
  ['یک مدل ویدیو انتخاب کن', 'Choose a video model', 'اختر نموذج فيديو', 'Bir video modeli seç'],
  ['یک مدل انتخاب کن', 'Choose a model', 'اختر نموذجًا', 'Bir model seç'],
  ['خطای غیرمنتظره؛ اگر تکرار شد صفحه را تازه کن.', 'Unexpected error. If it repeats, refresh the page.', 'خطأ غير متوقع. إن تكرر حدّث الصفحة.', 'Beklenmeyen hata. Tekrarlarsa sayfayı yenile.'],
  ['خطای غیرمنتظره', 'Unexpected error', 'خطأ غير متوقع', 'Beklenmeyen hata'],
  ['در حال رندر و ریزه‌کاری', 'Rendering and polishing', 'جارٍ المعالجة والتحسين', 'İşleniyor ve cilalanıyor'],
  ['هنوز در حال ساخت؛ بعضی مدل‌ها کند هستند', 'Still working; some models are slow', 'ما زال قيد العمل؛ بعض النماذج بطيئة', 'Hâlâ çalışıyor; bazı modeller yavaştır'],
  ['ساخت ویدیو در پس‌زمینه ادامه دارد. کمی بعد گفتگو را دوباره باز کن.', 'The video keeps rendering in the background. Reopen the chat in a moment.', 'يستمر إنشاء الفيديو في الخلفية. أعد فتح المحادثة بعد قليل.', 'Video arka planda üretilmeye devam ediyor. Biraz sonra sohbeti yeniden aç.'],
  ['ارتباط با سرور قطع شد. گفتگو را دوباره باز کن.', 'Lost connection to the server. Reopen the chat.', 'انقطع الاتصال بالخادم. أعد فتح المحادثة.', 'Sunucuyla bağlantı koptu. Sohbeti yeniden aç.'],
  ['در حال تولید ویدیو ·', 'Generating video ·', 'جارٍ إنشاء الفيديو ·', 'Video üretiliyor ·'],
  ['در حال تولید ویدیو', 'Generating video', 'جارٍ إنشاء الفيديو', 'Video üretiliyor'],
  ['در حال نوشتن پاسخ ·', 'Writing the reply ·', 'جارٍ كتابة الرد ·', 'Yanıt yazılıyor ·'],
  ['در حال نوشتن', 'Writing', 'جارٍ كتابة', 'Yazılıyor'],
  ['در حال فکر کردن', 'Thinking', 'جارٍ التفكير', 'Düşünüyor'],
  ['کاراکتر', 'characters', 'حرف', 'karakter'],
  ['در حافظه ذخیره شد:', 'Saved to memory:', 'حُفظ في الذاكرة:', 'Hafızaya kaydedildi:'],
  ['ارتباط قطع شد', 'Connection lost', 'انقطع الاتصال', 'Bağlantı koptu'],
  ['رایگان', 'Free', 'مجاني', 'Ücretsiz'],
  ['مدل تولید تصویر', 'Image generation model', 'نموذج توليد الصور', 'Görsel üretim modeli'],
  ['مدل ساخت ویدیو (مثلا sora-2؛ سرویس باید مسیر /videos سازگار با OpenAI داشته باشد)', 'Video model (e.g. sora-2; the service must expose an OpenAI-compatible /videos route)', 'نموذج الفيديو (مثل sora-2؛ يجب أن توفّر الخدمة مسار /videos متوافقًا مع OpenAI)', 'Video modeli (örn. sora-2; servis OpenAI uyumlu /videos yolunu sunmalı)'],
  ['مدل ساخت ویدیو', 'Video model', 'نموذج الفيديو', 'Video modeli'],
  ['رفتن به اتصال', 'Go to Connection', 'الذهاب إلى الاتصال', 'Bağlantıya git'],
  ['همه', 'All', 'الكل', 'Tümü'],
  ['استفاده از «', 'Use “', 'استخدام «', 'Kullan “'],
  ['نام دستی مدل', 'Enter a model name manually', 'أدخل اسم النموذج يدويًا', 'Model adını elle yaz'],
  ['مدلی پیدا نشد', 'No model found', 'لم يُعثر على نموذج', 'Model bulunamadı'],
  ['مدل تصویری شناسایی نشد؛ همه مدل‌ها نشان داده شده‌اند.', 'No image model detected; showing all models.', 'لم يُكتشف نموذج صور؛ عُرضت كل النماذج.', 'Görsel modeli bulunamadı; tüm modeller gösteriliyor.'],
  ['این سرویس مدل ویدیویی در فهرستش نشان نمی‌دهد؛ نام مدل را دستی بنویس (مثلا sora-2).', 'This service lists no video models; type the model name manually (e.g. sora-2).', 'لا تعرض هذه الخدمة نماذج فيديو؛ اكتب اسم النموذج يدويًا (مثل sora-2).', 'Bu servis video modeli listelemiyor; model adını elle yaz (örn. sora-2).'],
  ['حافظه شخصی', 'Personal memory', 'الذاكرة الشخصية', 'Kişisel hafıza'],
  ['هرچه اینجا روشن باشد، پیش از هر پیام برای مدل فرستاده می‌شود. حافظه به مدل وابسته نیست و با هر مدلی کار می‌کند.', 'Everything enabled here is sent to the model before each message. Memory is model-independent and works with any model.', 'كل ما هو مفعّل هنا يُرسل إلى النموذج قبل كل رسالة. الذاكرة مستقلة عن النموذج وتعمل مع أي نموذج.', 'Burada açık olan her şey her mesajdan önce modele gönderilir. Hafıza modelden bağımsızdır.'],
  ['ساخته‌شده خودکار', 'auto-created', 'مُنشأة تلقائيًا', 'otomatik oluşturuldu'],
  ['خاطره', 'memories', 'ذكريات', 'anı'],
  ['سنجاق‌شده', 'Pinned', 'مثبّتة', 'Sabitlenmiş'],
  ['سنجاق', 'Pin', 'تثبيت', 'Sabitle'],
  ['افزودن', 'Add', 'إضافة', 'Ekle'],
  ['دستی', 'Manual', 'يدوي', 'Elle'],
  ['ویرایش خاطره', 'Edit memory', 'تعديل الذكرى', 'Anıyı düzenle'],
  ['ویرایش', 'Edit', 'تعديل', 'Düzenle'],
  ['فعال', 'Enabled', 'مفعّل', 'Etkin'],
  ['چیزی اینجا نیست.', 'Nothing here.', 'لا شيء هنا.', 'Burada hiçbir şey yok.'],
  ['این خاطره حذف شود؟', 'Delete this memory?', 'حذف هذه الذكرى؟', 'Bu anı silinsin mi?'],
  ['جستجو در حافظه', 'Search memory', 'ابحث في الذاكرة', 'Hafızada ara'],
  ['جستجو در گفتگوها', 'Search chats', 'ابحث في المحادثات', 'Sohbetlerde ara'],
  ['جستجو:', 'Search:', 'بحث:', 'Ara:'],
  ['چیزی که باید همیشه یادش بماند', 'Something to always remember', 'شيء يجب تذكّره دائمًا', 'Her zaman hatırlanacak bir şey'],
  ['اتصال به API', 'API connection', 'الاتصال بواجهة API', 'API bağlantısı'],
  ['هر سرویسی که با فرمت OpenAI کار کند: OpenRouter، OpenAI، DeepSeek، Together و مشابه.', 'Any OpenAI-compatible service: OpenRouter, OpenAI, DeepSeek, Together and similar.', 'أي خدمة متوافقة مع OpenAI: OpenRouter وOpenAI وDeepSeek وTogether وما شابه.', 'OpenAI uyumlu her servis: OpenRouter, OpenAI, DeepSeek, Together vb.'],
  ['سرویس', 'Service', 'الخدمة', 'Servis'],
  ['آدرس پایه (Base URL)', 'Base URL', 'العنوان الأساسي (Base URL)', 'Temel adres (Base URL)'],
  ['کلید API', 'API key', 'مفتاح API', 'API anahtarı'],
  ['کلید API حذف شود؟', 'Remove the API key?', 'إزالة مفتاح API؟', 'API anahtarı kaldırılsın mı?'],
  ['برای تغییر، کلید جدید را وارد کن.', 'To change it, enter a new key.', 'للتغيير أدخل مفتاحًا جديدًا.', 'Değiştirmek için yeni anahtar gir.'],
  ['کلید فقط روی سرور و رمزنگاری‌شده ذخیره می‌شود و هرگز به مرورگر برنمی‌گردد.', 'The key is stored encrypted on the server only and never returns to the browser.', 'يُخزَّن المفتاح مشفّرًا على الخادم فقط ولا يعود إلى المتصفح أبدًا.', 'Anahtar yalnızca sunucuda şifreli saklanır ve tarayıcıya asla geri dönmez.'],
  ['ذخیره شده', 'Saved', 'محفوظ', 'Kayıtlı'],
  ['ذخیره شد', 'Saved', 'تم الحفظ', 'Kaydedildi'],
  ['تست اتصال', 'Test connection', 'اختبار الاتصال', 'Bağlantıyı test et'],
  ['مدل‌ها', 'Models', 'النماذج', 'Modeller'],
  ['مدل پیش‌فرض گفتگو', 'Default chat model', 'نموذج المحادثة الافتراضي', 'Varsayılan sohbet modeli'],
  ['مدل حافظه و خلاصه‌سازی (اختیاری، ارزان‌تر بهتر است)', 'Memory and summary model (optional, cheaper is better)', 'نموذج الذاكرة والتلخيص (اختياري، الأرخص أفضل)', 'Hafıza ve özet modeli (isteğe bağlı, ucuz olan iyi)'],
  ['مثلا anthropic/claude-sonnet-4', 'e.g. anthropic/claude-sonnet-4', 'مثال: anthropic/claude-sonnet-4', 'örn. anthropic/claude-sonnet-4'],
  ['خالی = همان مدل گفتگو', 'Empty = same as chat model', 'فارغ = نفس نموذج المحادثة', 'Boş = sohbet modeliyle aynı'],
  ['انتخاب از فهرست مدل‌ها', 'Pick from model list', 'اختيار من قائمة النماذج', 'Model listesinden seç'],
  ['به‌روزرسانی فهرست', 'Refresh list', 'تحديث القائمة', 'Listeyi yenile'],
  ['حافظه و رفتار', 'Memory and behavior', 'الذاكرة والسلوك', 'Hafıza ve davranış'],
  ['حافظه خودکار', 'Automatic memory', 'ذاكرة تلقائية', 'Otomatik hafıza'],
  ['بعد از هر گفتگو، موارد ماندگار را خودش ذخیره می‌کند.', 'After each chat, it saves lasting facts by itself.', 'بعد كل محادثة يحفظ المعلومات الدائمة بنفسه.', 'Her sohbetten sonra kalıcı bilgileri kendisi kaydeder.'],
  ['تشخیص خودکار عکس و ویدیو', 'Auto-detect image and video requests', 'اكتشاف تلقائي لطلبات الصور والفيديو', 'Görsel ve video isteklerini otomatik algıla'],
  ['تشخیص خودکار', 'Auto-detect', 'اكتشاف تلقائي', 'Otomatik algıla'],
  ['وقتی بنویسی «یه عکس خفن بساز»، خودش با مدل تصویر یا ویدیو می‌سازد.', 'When you write “make me an epic picture”, it uses the image or video model automatically.', 'عندما تكتب «اصنع صورة رائعة» يستخدم نموذج الصور أو الفيديو تلقائيًا.', '“Bana harika bir görsel yap” yazınca görsel veya video modelini kendisi kullanır.'],
  ['دستور سیستمی شخصی (روی همه گفتگوها اعمال می‌شود)', 'Personal system instructions (applied to all chats)', 'تعليمات النظام الشخصية (تُطبّق على كل المحادثات)', 'Kişisel sistem talimatı (tüm sohbetlere uygulanır)'],
  ['مثلا: همیشه کد را کامل و آماده کپی بده.', 'e.g. Always give complete, copy-ready code.', 'مثال: أعطني دائمًا الكود كاملًا وجاهزًا للنسخ.', 'örn. Kodu her zaman eksiksiz ve kopyalamaya hazır ver.'],
  ['حجم متن ارسالی به مدل (کاراکتر)', 'Context size sent to the model (characters)', 'حجم النص المرسل للنموذج (حروف)', 'Modele gönderilen bağlam boyutu (karakter)'],
  ['پیام‌های قدیمی‌تر از این حد، خودکار خلاصه می‌شوند و چیزی گم نمی‌شود.', 'Messages older than this are summarized automatically; nothing is lost.', 'الرسائل الأقدم من هذا الحد تُلخَّص تلقائيًا ولا يضيع شيء.', 'Bu sınırdan eski mesajlar otomatik özetlenir; hiçbir şey kaybolmaz.'],
  ['تنظیمات سیستمی', 'System settings', 'إعدادات النظام', 'Sistem ayarları'],
  ['دمای پاسخ (۰ تا ۲، خالی = پیش‌فرض مدل)', 'Temperature (0 to 2, empty = model default)', 'درجة الإبداع (0 إلى 2، فارغ = الافتراضي)', 'Sıcaklık (0–2, boş = model varsayılanı)'],
  ['عدد کمتر یعنی دقیق‌تر، عدد بیشتر یعنی خلاق‌تر.', 'Lower is more precise, higher is more creative.', 'الأقل أدق، والأعلى أكثر إبداعًا.', 'Düşük daha kesin, yüksek daha yaratıcıdır.'],
  ['پیش‌فرض', 'Default', 'افتراضي', 'Varsayılan'],
  ['سقف طول پاسخ (توکن، ۰ = خودکار)', 'Max reply length (tokens, 0 = auto)', 'الحد الأقصى لطول الرد (رموز، 0 = تلقائي)', 'Maks. yanıt uzunluğu (token, 0 = otomatik)'],
  ['مهلت پاسخ سرویس (ثانیه)', 'Service timeout (seconds)', 'مهلة الخدمة (ثوانٍ)', 'Servis zaman aşımı (saniye)'],
  ['اگر مدل‌های کند را استفاده می‌کنی این عدد را بیشتر کن.', 'Raise this if you use slow models.', 'ارفع هذا الرقم إن استخدمت نماذج بطيئة.', 'Yavaş modeller kullanıyorsan bunu artır.'],
  ['تعداد پشتیبان‌های نگهداری‌شده', 'Backups to keep', 'عدد النسخ الاحتياطية المحفوظة', 'Saklanan yedek sayısı'],
  ['مدت اعتبار ورود (روز)', 'Login validity (days)', 'مدة صلاحية الدخول (أيام)', 'Oturum süresi (gün)'],
  ['روی ورودهای جدید اعمال می‌شود.', 'Applies to new logins.', 'تُطبّق على عمليات الدخول الجديدة.', 'Yeni girişlere uygulanır.'],
  ['داده‌ها و پشتیبان', 'Data and backups', 'البيانات والنسخ الاحتياطي', 'Veri ve yedekler'],
  ['پشتیبان خودکار هر ۶ ساعت روی سرور گرفته می‌شود (۱۴ روز اخیر). برای امنیت واقعی، گاهی یک نسخه روی گوشی خودت هم نگه دار.', 'An automatic backup is taken every 6 hours on the server (last 14 days). For real safety, also keep a copy on your own device now and then.', 'تُؤخذ نسخة احتياطية تلقائية كل 6 ساعات على الخادم (آخر 14 يومًا). للأمان الحقيقي احتفظ بنسخة على جهازك أيضًا.', 'Sunucuda her 6 saatte otomatik yedek alınır (son 14 gün). Gerçek güvenlik için ara sıra kendi cihazında da bir kopya tut.'],
  ['خروجی JSON', 'Export JSON', 'تصدير JSON', 'JSON dışa aktar'],
  ['بازگردانی از JSON', 'Restore from JSON', 'استعادة من JSON', 'JSON’dan geri yükle'],
  ['خروج از همه دستگاه‌ها', 'Sign out of all devices', 'تسجيل الخروج من كل الأجهزة', 'Tüm cihazlardan çıkış yap'],
  ['همه نشست‌ها بسته می‌شوند و باید دوباره وارد شوی.', 'All sessions will be closed and you will need to sign in again.', 'ستُغلق كل الجلسات وعليك تسجيل الدخول مجددًا.', 'Tüm oturumlar kapanır; yeniden giriş yapman gerekir.'],
  ['خروج', 'Sign out', 'تسجيل الخروج', 'Çıkış'],
  ['نسخه / Node', 'Version / Node', 'الإصدار / Node', 'Sürüm / Node'],
  ['زمان فعال بودن', 'Uptime', 'مدة التشغيل', 'Çalışma süresi'],
  ['مسیر داده‌ها', 'Data path', 'مسار البيانات', 'Veri yolu'],
  ['دیتابیس', 'Database', 'قاعدة البيانات', 'Veritabanı'],
  ['پشتیبان‌گیری همین حالا', 'Back up now', 'نسخ احتياطي الآن', 'Şimdi yedekle'],
  ['پشتیبان ساخته شد', 'Backup created', 'تم إنشاء النسخة', 'Yedek oluşturuldu'],
  ['پشتیبان‌ها', 'Backups', 'النسخ الاحتياطية', 'Yedekler'],
  ['هنوز نیست', 'None yet', 'لا يوجد بعد', 'Henüz yok'],
  ['در حال تست...', 'Testing...', 'جارٍ الاختبار...', 'Test ediliyor...'],
  ['اول کلید را ذخیره کن', 'Save the key first', 'احفظ المفتاح أولًا', 'Önce anahtarı kaydet'],
  ['مدل دریافت شد', 'models loaded', 'نموذجًا جُلب', 'model alındı'],
  ['وارد شد:', 'Imported:', 'تم الاستيراد:', 'İçe aktarıldı:'],
  ['گفتگو،', 'chats,', 'محادثات،', 'sohbet,'],
  ['فایل معتبر نیست', 'Invalid file', 'ملف غير صالح', 'Geçersiz dosya'],
  ['اتصال کامل برقرار است', 'Fully connected', 'الاتصال يعمل بالكامل', 'Bağlantı tamam'],
  ['اتصال برقرار نشد', 'Could not connect', 'تعذّر الاتصال', 'Bağlanılamadı'],
  ['مصرف ۳۰ روز اخیر', 'Last 30 days usage', 'الاستهلاك خلال آخر 30 يومًا', 'Son 30 günün kullanımı'],
  ['اعداد از گزارش خود سرویس مقصد هستند.', 'Numbers come from the service’s own reports.', 'الأرقام من تقارير الخدمة نفسها.', 'Sayılar servisin kendi raporundandır.'],
  ['بعضی اعداد تخمینی‌اند چون سرویس مقصد مصرف را گزارش نکرده.', 'Some numbers are estimates because the service did not report usage.', 'بعض الأرقام تقديرية لأن الخدمة لم تُبلغ عن الاستهلاك.', 'Servis kullanım bildirmediği için bazı sayılar tahmindir.'],
  ['هزینه گزارش‌شده توسط سرویس', 'Cost reported by the service', 'التكلفة المُبلغ عنها من الخدمة', 'Servisin bildirdiği maliyet'],
  ['توکن در', 'tokens across', 'رمز في', 'token,'],
  ['درخواست', 'requests', 'طلبات', 'istek'],
  ['مدل', 'models', 'نماذج', 'model'],
  ['هنوز مصرفی ثبت نشده.', 'No usage recorded yet.', 'لم يُسجَّل أي استهلاك بعد.', 'Henüz kullanım kaydı yok.'],
  ['هنوز گفتگویی نیست', 'No chats yet', 'لا توجد محادثات بعد', 'Henüz sohbet yok'],
  ['موردی پیدا نشد', 'Nothing found', 'لم يُعثر على شيء', 'Sonuç bulunamadı'],
  ['منو', 'Menu', 'القائمة', 'Menü'],
  ['تم تیره/روشن', 'Dark/light theme', 'المظهر الداكن/الفاتح', 'Koyu/açık tema'],
  ['بستن', 'Close', 'إغلاق', 'Kapat'],
  ['خطا در نمایش صفحه', 'Error displaying the page', 'خطأ في عرض الصفحة', 'Sayfa gösterilirken hata'],
  ['خطا در بارگذاری برنامه', 'Error loading the app', 'خطأ في تحميل التطبيق', 'Uygulama yüklenirken hata'],
  ['مشکلی در بارگذاری پیش آمد', 'Something went wrong while loading', 'حدثت مشكلة أثناء التحميل', 'Yüklenirken bir sorun oluştu'],
  ['بارگذاری دوباره', 'Reload', 'إعادة التحميل', 'Yeniden yükle'],
  ['حجم درخواست بیش از حد مجاز است.', 'Request is too large.', 'حجم الطلب أكبر من المسموح.', 'İstek çok büyük.'],
  ['گفتگو پیدا نشد.', 'Chat not found.', 'المحادثة غير موجودة.', 'Sohbet bulunamadı.'],
  ['پیام پیدا نشد.', 'Message not found.', 'الرسالة غير موجودة.', 'Mesaj bulunamadı.'],
  ['رمز عبور اشتباه است.', 'Wrong password.', 'كلمة المرور خاطئة.', 'Parola yanlış.'],
  ['تلاش‌های ناموفق زیاد بود.', 'Too many failed attempts.', 'محاولات فاشلة كثيرة.', 'Çok fazla başarısız deneme.'],
  ['دقیقه دیگر دوباره امتحان کن.', 'minutes before trying again.', 'دقيقة قبل المحاولة مجددًا.', 'dakika sonra tekrar dene.'],
  ['نشست منقضی شده. دوباره وارد شو.', 'Session expired. Sign in again.', 'انتهت الجلسة. سجّل الدخول مجددًا.', 'Oturum doldu. Yeniden giriş yap.'],
  ['پیام خالی است.', 'Message is empty.', 'الرسالة فارغة.', 'Mesaj boş.'],
  ['خطای نامشخص', 'Unknown error', 'خطأ غير معروف', 'Bilinmeyen hata'],
  ['فایل خالی است.', 'File is empty.', 'الملف فارغ.', 'Dosya boş.'],
  ['فایل پیدا نشد.', 'File not found.', 'الملف غير موجود.', 'Dosya bulunamadı.'],
  ['این فایل ویدیو نیست.', 'This file is not a video.', 'هذا الملف ليس فيديو.', 'Bu dosya bir video değil.'],
  ['استخراج صدا روی این سرور فعال نیست (ffmpeg نصب نیست).', 'Audio export is not available on this server (ffmpeg is not installed).', 'استخراج الصوت غير متاح على هذا الخادم (ffmpeg غير مثبّت).', 'Bu sunucuda ses çıkarma yok (ffmpeg kurulu değil).'],
  ['این ویدیو صدا ندارد.', 'This video has no audio.', 'هذا الفيديو بلا صوت.', 'Bu videoda ses yok.'],
  ['استخراج صدا ناموفق بود.', 'Audio extraction failed.', 'فشل استخراج الصوت.', 'Ses çıkarma başarısız.'],
  ['فایلی در این پیام نیست.', 'No files in this message.', 'لا ملفات في هذه الرسالة.', 'Bu mesajda dosya yok.'],
  ['هیچ مدلی انتخاب نشده است.', 'No model selected.', 'لم يُختر أي نموذج.', 'Model seçilmedi.'],
  ['اتصال API هنوز تنظیم نشده است. از بخش «اتصال» آدرس و کلید را وارد کن.', 'The API connection is not set up yet. Enter the URL and key in “Connection”.', 'لم يُضبط اتصال API بعد. أدخل العنوان والمفتاح في «الاتصال».', 'API bağlantısı henüz ayarlanmadı. “Bağlantı”dan adres ve anahtarı gir.'],
  ['کلید API نامعتبر است یا منقضی شده.', 'The API key is invalid or expired.', 'مفتاح API غير صالح أو منتهٍ.', 'API anahtarı geçersiz veya süresi dolmuş.'],
  ['اعتبار حساب تمام شده است.', 'Your account credit has run out.', 'نفد رصيد الحساب.', 'Hesap kredin bitti.'],
  ['محدودیت تعداد درخواست یا سهمیه. کمی بعد دوباره امتحان کن.', 'Rate limit or quota reached. Try again shortly.', 'تم بلوغ حد الطلبات أو الحصة. حاول بعد قليل.', 'İstek sınırı veya kota aşıldı. Biraz sonra tekrar dene.'],
  ['سرویس مقصد موقتا مشکل دارد.', 'The service is having temporary problems.', 'الخدمة تواجه مشكلة مؤقتة.', 'Servis geçici sorun yaşıyor.'],
  ['ارتباط با سرویس برقرار نشد.', 'Could not reach the service.', 'تعذّر الوصول إلى الخدمة.', 'Servise ulaşılamadı.'],
  ['سرویس در زمان مقرر پاسخ نداد.', 'The service did not answer in time.', 'لم تستجب الخدمة في الوقت المحدد.', 'Servis zamanında yanıt vermedi.'],
  ['این مدل تصویری برنگرداند. یک مدل تولید تصویر انتخاب کن.', 'This model returned no image. Choose an image generation model.', 'لم يُرجع هذا النموذج صورة. اختر نموذج توليد صور.', 'Bu model görsel döndürmedi. Bir görsel üretim modeli seç.'],
  ['خطای داخلی سرور.', 'Internal server error.', 'خطأ داخلي في الخادم.', 'Sunucu iç hatası.'],
  ['پیش‌نمایش پیدا نشد.', 'Preview not found.', 'المعاينة غير موجودة.', 'Önizleme bulunamadı.'],
  // new UI
  ['ساخت سریع', 'Fast build', 'بناء سريع', 'Hızlı yapım'],
  ['سریع', 'Fast', 'سريع', 'Hızlı'],
  ['ساخت سریع روشن شد: پروژه جمع‌وجور و بدون حاشیه', 'Fast build on: compact project, no fluff', 'تم تفعيل البناء السريع: مشروع مضغوط بلا إطالة', 'Hızlı yapım açık: derli toplu proje'],
  ['ساخت سریع خاموش شد', 'Fast build off', 'تم إيقاف البناء السريع', 'Hızlı yapım kapalı'],
  ['بررسی خودکار: بدون خطا', 'Auto-check: no errors', 'الفحص التلقائي: لا أخطاء', 'Otomatik kontrol: hata yok'],
  ['مشکل پیدا شد', 'problems found', 'مشاكل مكتشفة', 'sorun bulundu'],
  ['رفع خودکار', 'Auto-fix', 'إصلاح تلقائي', 'Otomatik düzelt'],
  ['خطا هنگام اجرا', 'runtime errors', 'أخطاء أثناء التشغيل', 'çalışma hatası'],
  ['خطای نحوی در', 'Syntax error in', 'خطأ في الصياغة في', 'Sözdizimi hatası:'],
  ['JSON نامعتبر در', 'Invalid JSON in', 'JSON غير صالح في', 'Geçersiz JSON:'],
  ['فایل ارجاع‌شده وجود ندارد', 'references a missing file', 'يشير إلى ملف غير موجود', 'eksik dosyaya başvuruyor'],
  ['پاسخ وسط فایل قطع شده', 'reply was cut off mid-file', 'انقطع الرد في منتصف الملف', 'yanıt dosyanın ortasında kesildi'],
  ['فایل index.html وجود ندارد', 'index.html is missing', 'ملف index.html مفقود', 'index.html eksik'],
  ['آکولادهای CSS ناقص در', 'Unbalanced CSS braces in', 'أقواس CSS غير متوازنة في', 'Dengesiz CSS parantezleri:'],
  ['HTML ناتمام است', 'HTML looks unfinished', 'يبدو أن HTML غير مكتمل', 'HTML yarım görünüyor'],
  ['فایل خالی', 'empty file', 'ملف فارغ', 'boş dosya'],
  ['کد ناتمام در', 'Placeholder code in', 'شيفرة غير مكتملة في', 'Yarım kod:'],
  ['اتصال‌های ذخیره‌شده', 'Saved connections', 'الاتصالات المحفوظة', 'Kayıtlı bağlantılar'],
  ['هر کلیدی که ذخیره کنی اینجا نگه داشته می‌شود (رمزنگاری‌شده روی سرور). می‌توانی بین کلیدها جابه‌جا شوی یا هرکدام را حذف کنی و کلید تازه بزنی.', 'Every key you save is kept here (encrypted on the server). Switch between keys, or delete one and add a new key.', 'كل مفتاح تحفظه يبقى هنا (مشفّرًا على الخادم). يمكنك التبديل بين المفاتيح أو حذف أحدها وإضافة مفتاح جديد.', 'Kaydettiğin her anahtar burada saklanır (sunucuda şifreli). Anahtarlar arasında geçiş yapabilir, birini silip yenisini ekleyebilirsin.'],
  ['هنوز اتصالی ذخیره نشده. کلید را وارد و ذخیره کن.', 'No saved connection yet. Enter a key and save.', 'لا اتصال محفوظ بعد. أدخل مفتاحًا واحفظه.', 'Henüz kayıtlı bağlantı yok. Bir anahtar girip kaydet.'],
  ['فعال‌سازی', 'Activate', 'تفعيل', 'Etkinleştir'],
  ['این اتصال و کلیدش حذف شود؟', 'Delete this connection and its key?', 'حذف هذا الاتصال ومفتاحه؟', 'Bu bağlantı ve anahtarı silinsin mi?'],
  ['بسته‌ی انتقال حافظه', 'Memory handoff pack', 'حزمة نقل الذاكرة', 'Hafıza aktarım paketi'],
  ['همه‌چیز درباره‌ی تو و کارهایی که با هم کرده‌اید در یک فایل، تا بتوانی بکاپ بگیری یا به هر هوش مصنوعی دیگری بدهی.', 'Everything about you and the work you did together in one file, to back up or hand to any other AI.', 'كل شيء عنك وعن العمل الذي أنجزتماه معًا في ملف واحد، للنسخ الاحتياطي أو لتسليمه لأي ذكاء اصطناعي آخر.', 'Senin ve birlikte yaptığınız işlerin hepsi tek dosyada; yedekle veya başka bir yapay zekaya ver.'],
  ['دانلود Markdown', 'Download Markdown', 'تنزيل Markdown', 'Markdown indir'],
  ['خلاصه‌ی هوشمند برای هوش مصنوعی دیگر', 'Smart briefing for another AI', 'ملخص ذكي لذكاء اصطناعي آخر', 'Başka bir yapay zeka için akıllı özet'],
  ['خلاصه‌ی هوشمند', 'Smart briefing', 'ملخص ذكي', 'Akıllı özet'],
  ['وارد کردن حافظه', 'Import memory', 'استيراد الذاكرة', 'Hafızayı içe aktar'],
  ['فعال', 'Active', 'نشط', 'Etkin'],
  ['اتصال و کلیدش', 'connection and key', 'الاتصال ومفتاحه', 'bağlantı ve anahtar'],
  ['اتصال ذخیره‌شده پیدا نشد.', 'Saved connection not found.', 'الاتصال المحفوظ غير موجود.', 'Kayıtlı bağlantı bulunamadı.'],
  ['زبان', 'Language', 'اللغة', 'Dil'],
  ['اعتبار باقی‌مانده', 'Credit remaining', 'الرصيد المتبقي', 'Kalan kredi'],
  ['کل اعتبار', 'Total credit', 'إجمالي الرصيد', 'Toplam kredi'],
  ['مصرف‌شده', 'Used', 'المستخدم', 'Kullanılan'],
  ['نامحدود', 'Unlimited', 'غير محدود', 'Sınırsız'],
  ['اعتبار رو به پایان است', 'Credit is running low', 'الرصيد على وشك النفاد', 'Kredi azalıyor'],
  ['سرویس شما موجودی را اعلام نمی‌کند', 'Your provider does not report a balance', 'مزوّدك لا يعرض الرصيد', 'Sağlayıcın bakiye bildirmiyor'],
  ['تازه‌سازی', 'Refresh', 'تحديث', 'Yenile'],
  ['اعتبار', 'Credit', 'الرصيد', 'Kredi'],
  ['پیش‌نمایش', 'Preview', 'معاينة', 'Önizleme'],
  ['باز کردن در تب جدید', 'Open in new tab', 'فتح في تبويب جديد', 'Yeni sekmede aç'],
  ['کیفیت بالا', 'High quality', 'جودة عالية', 'Yüksek kalite'],
  ['تصویر', 'Image', 'صورة', 'Görsel'],
  ['ویدیو', 'Video', 'فيديو', 'Video'],
  ['خوش آمدی', 'welcome', 'أهلًا بك', 'hoş geldin'],
  ['ساخت پروژه، سایت، تصویر و ویدیو', 'Build projects, sites, images and videos', 'ابنِ المشاريع والمواقع والصور والفيديو', 'Proje, site, görsel ve video üret'],
];

const PERSIAN = /[\u0600-\u06FF]/;
const FA_DIGITS = /[۰-۹]/g;
const normDigits = (s) => s.replace(FA_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/٪/g, '%').replace(/،/g, ',');

let EXACT = new Map();
let FRAGS = [];
const colOf = { en: 1, ar: 2, tr: 3 };

function build() {
  const col = colOf[lang];
  if (!col) return;
  const frag = [];
  for (const row of T) {
    const to = row[col];
    const key = normDigits(row[0]).trim();
    EXACT.set(key, to);
    frag.push([key, to]);
  }
  frag.sort((a, b) => b[0].length - a[0].length);
  FRAGS = frag.map(([k, v]) => [new RegExp('(?<![\\u0600-\\u06FF])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\u0600-\\u06FF])', 'g'), v]);
}

build();

export function tr(text) {
  if (lang === 'fa' || !text || !(PERSIAN.test(text) || /[۰-۹]/.test(text))) return text;
  const lead = /^\s*/.exec(text)[0], trail = /\s*$/.exec(text)[0];
  let core = normDigits(text.trim());
  const hit = EXACT.get(core);
  if (hit !== undefined) return lead + hit + trail;
  if (!PERSIAN.test(core)) return lead + core + trail;
  for (const [re, to] of FRAGS) core = core.replace(re, to);
  return lead + core + trail;
}

const SKIP = '.md, .bubble, .rbody, .memlist, .mem .txt, textarea, script, style, code, pre, [data-notr], .ltr-keep';
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

function fixNode(n) {
  const p = n.parentElement;
  if (!p || p.closest(SKIP)) return;
  if (p.closest('.conv a') && !EXACT.has(n.data.trim())) return;
  const out = tr(n.data);
  if (out !== n.data) n.data = out;
}
function fixAttrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (v && (PERSIAN.test(v) || /[۰-۹]/.test(v)) && !el.closest(SKIP)) {
      const out = tr(v);
      if (out !== v) el.setAttribute(a, out);
    }
  }
}
function walk(root) {
  if (root.nodeType === 3) return fixNode(root);
  if (root.nodeType !== 1) return;
  fixAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) fixNode(n);
  root.querySelectorAll?.(ATTRS.map((a) => `[${a}]`).join(',')).forEach(fixAttrs);
}

export function startI18n() {
  const info = LANGS[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = info.dir;
  if (lang === 'fa') return;
  document.title = 'Jinx';
  walk(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') fixNode(m.target);
      else if (m.type === 'attributes') fixAttrs(m.target);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
