import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SERVER_PORT } from "@drift/shared";

export const LAST_URL_KEY = "drift.lastUrl";

/** QR text or a typed address → socket URL. LAN IPs get ws://ip:8080, domain names get wss://. */
function normalize(input: string): string | null {
  const s = input.trim();
  if (/^wss?:\/\/[^\s]+$/i.test(s)) return s;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(s)) return `ws://${s.includes(":") ? s : `${s}:${SERVER_PORT}`}`;
  const host = s.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(host)) return `wss://${host}`;
  return null;
}

export function ConnectScreen({ onConnect }: { onConnect: (url: string) => void }) {
  const [perm, requestPerm] = useCameraPermissions();
  const [ip, setIp] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(LAST_URL_KEY).then(setLast);
  }, []);

  const go = (url: string | null) => {
    if (!url || done.current) return;
    done.current = true;
    AsyncStorage.setItem(LAST_URL_KEY, url);
    onConnect(url);
  };

  return (
    <View style={styles.root}>
      <View style={styles.cameraBox}>
        {perm?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => go(normalize(data))}
          />
        ) : (
          <Pressable style={styles.btn} onPress={requestPerm}>
            <Text style={styles.btnText}>Kamerayı aç</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.side}>
        <Text style={styles.title}>Drift kontrolcü</Text>
        <Text style={styles.hint}>Bilgisayardaki QR kodu okut</Text>
        <TextInput
          style={styles.input}
          placeholder="ya da IP gir: 192.168.1.20"
          placeholderTextColor="#998"
          value={ip}
          onChangeText={setIp}
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          onSubmitEditing={() => go(normalize(ip))}
        />
        <Pressable style={styles.btn} onPress={() => go(normalize(ip))}>
          <Text style={styles.btnText}>Bağlan</Text>
        </Pressable>
        {last && (
          <Pressable style={[styles.btn, styles.secondary]} onPress={() => go(last)}>
            <Text style={styles.btnText}>Son bağlantı: {last.replace(/^wss?:\/\//, "")}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: "#1a1026", padding: 20, gap: 20 },
  cameraBox: { flex: 1, borderRadius: 16, overflow: "hidden", backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  side: { flex: 1, justifyContent: "center", gap: 12 },
  title: { color: "#fff", fontSize: 26, fontWeight: "800" },
  hint: { color: "#d8c6d0", fontSize: 15 },
  input: { backgroundColor: "#2c1f3d", color: "#fff", borderRadius: 10, padding: 12, fontSize: 16 },
  btn: { backgroundColor: "#ff6b5a", borderRadius: 10, padding: 14, alignItems: "center" },
  secondary: { backgroundColor: "#4a3560" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
