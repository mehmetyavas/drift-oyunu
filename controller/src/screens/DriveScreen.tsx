import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import * as ScreenOrientation from "expo-screen-orientation";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { HapticKind } from "@drift/shared";
import { useControllerSocket } from "../net";
import { useSteering } from "../useSteering";

const INVERT_KEY = "drift.invert";
const EXTREME_KEY = "drift.extremeUsed";
const HAPTIC: Record<HapticKind, Haptics.ImpactFeedbackStyle> = {
  comboUp: Haptics.ImpactFeedbackStyle.Light,
  comboEnd: Haptics.ImpactFeedbackStyle.Medium,
  reset: Haptics.ImpactFeedbackStyle.Heavy,
  drift: Haptics.ImpactFeedbackStyle.Soft,
};

export function DriveScreen({ url, onBack }: { url: string; onBack: () => void }) {
  useKeepAwake();
  const [invert, setInvert] = useState(false);
  const [menu, setMenu] = useState(false);
  const { steer, steerRef, calibrate } = useSteering(invert);
  const { connected, status, send } = useControllerSocket(url, (k) => Haptics.impactAsync(HAPTIC[k]));
  const [brake, setBrake] = useState(false);
  const [nitro, setNitro] = useState(false);
  const pedals = useRef({ brake: false, nitro: false });
  pedals.current = { brake, nitro };

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    AsyncStorage.getItem(INVERT_KEY).then((v) => setInvert(v === "1"));
  }, []);

  useEffect(() => {
    let seq = 0;
    const id = setInterval(() => {
      send({ t: "input", steer: steerRef.current, brake: pedals.current.brake, nitro: pedals.current.nitro, seq: seq++ });
    }, 16);
    return () => clearInterval(id);
  }, [send, steerRef]);

  // Pulse the EXTREME button until the player has tried it once.
  const [extremeUsed, setExtremeUsed] = useState(true);
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    AsyncStorage.getItem(EXTREME_KEY).then((v) => setExtremeUsed(v === "1"));
  }, []);
  useEffect(() => {
    if (extremeUsed) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 450, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 450, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(1);
    };
  }, [extremeUsed, pulse]);
  const markExtremeUsed = () => {
    setExtremeUsed(true);
    AsyncStorage.setItem(EXTREME_KEY, "1");
  };

  const toggleInvert = () => {
    const v = !invert;
    setInvert(v);
    AsyncStorage.setItem(INVERT_KEY, v ? "1" : "0");
  };

  const doCalibrate = () => {
    calibrate();
    send({ t: "calibrate" });
  };

  return (
    <View style={styles.root}>
      <Pressable style={[styles.pedal, brake && styles.brakeOn]} onPressIn={() => setBrake(true)} onPressOut={() => setBrake(false)}>
        <Text style={styles.pedalIcon}>⏬</Text>
        <Text style={styles.pedalText}>FREN</Text>
      </Pressable>

      <View style={styles.center}>
        {/* Top: connection + score */}
        <View style={styles.top}>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: connected ? "#5be37d" : "#ff5a5a" }]} />
            <Text style={styles.statusText}>{connected ? "Bağlı" : "Bağlanıyor…"}</Text>
          </View>
          <Text style={styles.score}>{status ? status.score.toLocaleString("tr-TR") : "—"}</Text>
          <Text style={styles.combo}>{status && status.combo > 0 ? `+${status.combo}  x${status.multiplier}` : " "}</Text>
          {status?.rank ? <Text style={styles.rank}>{`${status.rank}. / ${status.players}`}</Text> : null}
        </View>

        {/* Middle: steering wheel */}
        <View style={[styles.wheel, { transform: [{ rotate: `${steer * 90}deg` }] }]}>
          <View style={styles.spoke} />
          <View style={styles.marker} />
        </View>

        {/* Bottom: EXTREME + settings */}
        <View style={styles.bottom}>
          <Animated.View style={{ transform: [{ scale: pulse }] }}>
            <Pressable
              style={[styles.extreme, (status?.extreme || !extremeUsed) && styles.extremeOn]}
              onPress={() => {
                send({ t: "toggleMode" });
                markExtremeUsed();
              }}
            >
              <Text style={styles.extremeText}>{status?.extreme ? "EXTREME AÇIK" : "🔥 EXTREME"}</Text>
            </Pressable>
          </Animated.View>
          <Pressable style={styles.gear} onPress={() => send({ t: "camera" })} hitSlop={10} accessibilityLabel="Kamera değiştir">
            <Text style={styles.gearText}>🎥</Text>
          </Pressable>
          <Pressable style={styles.gear} onPress={() => setMenu(true)} hitSlop={10} accessibilityLabel="Ayarlar">
            <Text style={styles.gearText}>⚙</Text>
          </Pressable>
        </View>
      </View>

      <Pressable style={[styles.pedal, nitro && styles.nitroOn]} onPressIn={() => setNitro(true)} onPressOut={() => setNitro(false)}>
        <Text style={styles.pedalIcon}>🔥</Text>
        <Text style={styles.pedalText}>NİTRO</Text>
      </Pressable>

      {menu && (
        <Pressable style={styles.backdrop} onPress={() => setMenu(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Ayarlar</Text>
            <Pressable style={styles.sheetBtn} onPress={() => { doCalibrate(); setMenu(false); }}>
              <Text style={styles.sheetBtnText}>🎯  Kalibre et</Text>
              <Text style={styles.sheetHint}>Şu anki duruşu "düz" kabul eder</Text>
            </Pressable>
            <Pressable style={styles.sheetBtn} onPress={toggleInvert}>
              <Text style={styles.sheetBtnText}>↔️  Yönü çevir {invert ? "(çevrili)" : ""}</Text>
              <Text style={styles.sheetHint}>Araba ters dönüyorsa</Text>
            </Pressable>
            <Pressable style={[styles.sheetBtn, styles.sheetExit]} onPress={onBack}>
              <Text style={styles.sheetBtnText}>🚪  Bağlantıdan çık</Text>
            </Pressable>
          </View>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: "#1a1026" },
  pedal: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#24182f", gap: 6 },
  brakeOn: { backgroundColor: "#5a2a3a" },
  nitroOn: { backgroundColor: "#2a4a6a" },
  pedalIcon: { fontSize: 34, opacity: 0.7 },
  pedalText: { color: "#ffffff99", fontSize: 22, fontWeight: "800", letterSpacing: 3 },
  center: { width: 300, alignItems: "center", justifyContent: "space-between", paddingVertical: 18 },
  top: { alignItems: "center", gap: 2 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { color: "#ffffff99", fontSize: 13 },
  score: { color: "#fff", fontSize: 30, fontWeight: "800" },
  combo: { color: "#ffd27a", fontSize: 18, fontWeight: "700", height: 24 },
  rank: { color: "#ff8a2a", fontSize: 16, fontWeight: "900", fontStyle: "italic", letterSpacing: 2 },
  wheel: { width: 120, height: 120, borderRadius: 60, borderWidth: 10, borderColor: "#ff6b5a", alignItems: "center", justifyContent: "center" },
  spoke: { width: 100, height: 8, backgroundColor: "#ff6b5a", borderRadius: 4 },
  marker: { position: "absolute", top: -2, width: 8, height: 16, backgroundColor: "#fff", borderRadius: 3 },
  bottom: { flexDirection: "row", alignItems: "center", gap: 14 },
  extreme: { backgroundColor: "#3a2a4a", borderRadius: 14, paddingHorizontal: 26, paddingVertical: 14, minWidth: 170, alignItems: "center" },
  extremeOn: { backgroundColor: "#ff3a2a" },
  extremeText: { color: "#fff", fontSize: 17, fontWeight: "900", letterSpacing: 1 },
  gear: { width: 50, height: 50, borderRadius: 25, backgroundColor: "#3a2a4a", alignItems: "center", justifyContent: "center" },
  gearText: { color: "#fff", fontSize: 24 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000000aa", alignItems: "center", justifyContent: "center" },
  sheet: { width: 360, backgroundColor: "#2a1d3a", borderRadius: 18, padding: 18, gap: 10 },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "800", marginBottom: 4 },
  sheetBtn: { backgroundColor: "#3a2a4a", borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16 },
  sheetExit: { backgroundColor: "#4a2030" },
  sheetBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  sheetHint: { color: "#ffffff88", fontSize: 13, marginTop: 2 },
});
