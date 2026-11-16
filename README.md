# Drift

Telefonu direksiyon gibi kullandığın, sonsuz yollu bir drift oyunu.
Oyun bilgisayarın tarayıcısında açılır, iPhone kontrolcü olur.

**Özellikler:** dört ortam (çöl, neon şehir, karlı dağ, sonbahar ormanı) · sonsuz prosedürel yol ·
kombo ve çarpan · extreme mod · tezahürat yapan seyirciler (çarpınca polis gelir) ·
kodla üretilen motor/lastik/egzoz/siren sesleri ve synthwave müzik · karanlıkta otomatik farlar ·
bağlantı koparsa duraklama ve 3-2-1 geri sayım.

## Hızlı kurulum

Ayrıntılar [KURULUM.md](KURULUM.md) dosyasında. Kısaca: klonla, `npm start` de; paketler ilk açılışta kendiliğinden kurulur.

```bash
# Windows
powershell -ExecutionPolicy Bypass -File setup.ps1
# macOS / Linux
bash setup.sh
```

Yapay zekâ aracıyla (Claude Code, Cursor, Codex…) açarsan `AGENTS.md` sayesinde kurulumu kendisi başlatır.

## Kurulum (elle)

Gerekenler: Node.js 22+ ve iPhone'da **Expo Go** uygulaması (App Store).

```bash
npm install
```

## Oynamak

1. **Oyunu başlat** (bilgisayarda):
   ```bash
   npm start
   ```
   Konsolda `Oyun: http://192.168.x.x:8080` yazar. Bu adresi Chrome'da aç.
   İlk çalıştırmada Windows Güvenlik Duvarı sorarsa **Özel ağlar** için izin ver.

2. **Kontrolcüyü başlat** (ikinci bir terminalde):
   ```bash
   npm run controller
   ```
   Çıkan QR kodu iPhone kamerasıyla okut, uygulama Expo Go'da açılır.

3. Kontrolcüde oyun ekranının köşesindeki QR kodu okut (ya da IP'yi elle gir).

### Kontroller

| Telefonda | Ne yapar |
|---|---|
| Sağa/sola çevir | Direksiyon. Hızlıyken sert çevir, drift at |
| Sol yarıya basılı tut | Fren |
| Sağ yarıya basılı tut | Nitro |
| Kalibre et | O anki duruşu "düz" kabul eder |
| Yönü çevir | Araba ters yöne dönüyorsa bas |
| EXTREME | Extreme modu açar/kapatır (klavyede E) |
| 🎥 | Kamerayı değiştirir (klavyede C) |

Telefonsuz denemek için: ← → direksiyon, ↓ fren, ↑ nitro, C kamera.

Art arda drift at, çarpan yükselsin (x10'a kadar). Yoldan çıkarsan birikmekte olan kombo silinir, oyun devam eder.

### Kameralar

C tuşu (ya da telefondaki 🎥) sırayla geçer: **takip**, **uzak takip**, **kaput**, **tampon**, **helikopter**, **TV kamerası**
(yol kenarına kurulup arabayı zoom'la izler). Seçim tarayıcıda hatırlanır.

## Telefonda oynamak (uygulamasız)

Siteyi telefon tarayıcısında aç, oyun telefonda çalışır: **telefonu direksiyon gibi eğ** (iPhone'da 📱'ye dokunup hareket
iznini ver), ya da 🕹️ ile **◀ ▶ düğmelerine** geç. Sağda **FREN** ve **NİTRO**, üstte ☰ menü, 🎥 kamera, 🎯 ortala, ↔ yönü çevir.
İlk dokunuşta tam ekrana geçer (Android'de yatay kilitlenir); Android'de drift ve kombolarda titrer. Masaüstünde
denemek için adrese `?touch=1` ekle.

## Çok oyunculu (internet üzerinden)

Canlı sunucu: **https://drift.restopanel.com.tr**

1. Sol üstteki **👥 Çok oyunculu**'ya bas (ya da Esc / telefonda ☰), adını yaz, **Oda kur**.
2. Bekleme odası açılır: 4 harfli kodu ya da **Davet linkini** gönder, gelenler boş yuvalara oturur ("👋 … katıldı").
3. Kurucu modu seçer. İsterse arkadaşlarını bekler, isterse **TEK BAŞINA BAŞLA** der. Herkes aynı yolda aynı anda 3-2-1 ile başlar.
4. Tur başladıktan sonra gelen de oyuna girer: Drift Savaşı / Hayalet / Serbest'te sondaki arabanın yanına iner, kalan süreyle
   oynar. Yarış'ta ortadan girmek haksızlık olacağından lideri izler ve sonraki turda başlar.

| Mod | Kural |
|---|---|
| 🔥 Drift Savaşı | Süre (2/3/5 dk) dolana kadar en çok puan. Sert çarpışma süren komboyu bozar. |
| 🏁 Yarış | 4 km'lik bitişe ilk varan kazanır. İlk bitirenden 30 sn sonra tur kapanır. |
| 👻 Hayalet Drift | Drift Savaşı gibi, ama arabalar birbirinin içinden geçer (yarı saydam). |
| 🌄 Serbest | Süre yok, canlı sıralama. Tur sürerken gelen oyuncu hemen katılır, kurucu bitirir. |

EXTREME bir oda ayarıdır (herkes için). Oda en çok 8 kişi alır. Her oyuncu kendi telefonunu ekrandaki QR'la
kendi oyununa bağlar (QR, sayfaya özel bir eşleşme kodu taşır; sayfa yenilense de aynı kalır).

Teknik: istemci kendi arabasını simüle eder ve saniyede 20 kez konumunu yollar; diğer arabalar 120 ms gecikmeli
ara değerlemeyle çizilir, çarpışmayı her oyuncu kendi arabası için çözer. Sunucu oda, süre, bitiş ve sıralamadan sorumlu.

## Sunucuya kurulum

`Dockerfile` oyunu derleyip sunucuyu tek dosyaya paketler (çalışan imaj ~14 MB RAM). Traefik/Coolify olan bir
sunucuda `deploy/docker-compose.yml` hazır: `coolify` ağına bağlanır, Let's Encrypt sertifikasını Traefik alır.

```bash
deploy/deploy.sh            # ~/.ssh/config'teki "drift-vps" sunucusuna gönderir ve yeniden kurar
DOMAIN=oyun.ornek.com ...   # farklı alan adı için deploy/.env içine DOMAIN=... yaz
```

Sunucu `X-Forwarded-Proto: https` görünce tarayıcıya ve QR'a `wss://` adresini verir; `PUBLIC_WS_URL` ile elle de verilebilir.

## Sorun giderme

- **Telefon bağlanmıyor:** telefon ve bilgisayar aynı Wi-Fi'da mı? Güvenlik duvarında Node.js'e izin verildi mi?
- **Direksiyon kayıyor:** telefonu düz tut, *Kalibre et*'e bas.
- **Sürüş hissi:** tüm ayarlar `game/src/sim/tuning.ts` içinde. Değiştirip `npm start` ile yeniden başlat.

## Geliştirme

```bash
npm test      # oyun mantığı testleri
```
