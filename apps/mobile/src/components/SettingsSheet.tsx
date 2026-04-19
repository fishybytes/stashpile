import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export type FontSizeKey = 'small' | 'medium' | 'large';
export const FONT_SIZE_VALUES: Record<FontSizeKey, number> = { small: 15, medium: 17, large: 21 };

const FONT_OPTIONS: { key: FontSizeKey; label: string }[] = [
  { key: 'small', label: 'Small' },
  { key: 'medium', label: 'Medium' },
  { key: 'large', label: 'Large' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  fontSize: FontSizeKey;
  onFontSizeChange: (s: FontSizeKey) => void;
  onOpenSaved: () => void;
  onOpenProfile: () => void;
}

export function SettingsSheet({ visible, onClose, fontSize, onFontSizeChange, onOpenSaved, onOpenProfile }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <Text style={styles.section}>Reading</Text>
          <View style={styles.fontRow}>
            {FONT_OPTIONS.map(opt => (
              <Pressable
                key={opt.key}
                style={[styles.fontBtn, fontSize === opt.key && styles.fontBtnActive]}
                onPress={() => onFontSizeChange(opt.key)}
              >
                <Text style={[styles.fontAa, { fontSize: FONT_SIZE_VALUES[opt.key] }, fontSize === opt.key && styles.fontAaActive]}>
                  Aa
                </Text>
                <Text style={[styles.fontLabel, fontSize === opt.key && styles.fontLabelActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.divider} />

          <Text style={styles.section}>Library</Text>
          <Pressable style={styles.row} onPress={onOpenSaved}>
            <Text style={styles.rowLabel}>Saved comments</Text>
            <Text style={styles.rowArrow}>›</Text>
          </Pressable>
          <Pressable style={styles.row} onPress={onOpenProfile}>
            <Text style={styles.rowLabel}>Taste profile</Text>
            <Text style={styles.rowArrow}>›</Text>
          </Pressable>

          <View style={styles.divider} />

          <Text style={styles.section}>Account</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Sign in</Text>
            <Text style={styles.comingSoon}>Coming soon</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#161b22',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#30363d',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#30363d',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 24,
  },
  section: {
    fontSize: 11,
    color: '#8b949e',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  fontRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  fontBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#0d1117',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#30363d',
    gap: 4,
  },
  fontBtnActive: {
    borderColor: '#ff4500',
    backgroundColor: 'rgba(255,69,0,0.08)',
  },
  fontAa: {
    color: '#8b949e',
    fontWeight: '600',
  },
  fontAaActive: {
    color: '#ff4500',
  },
  fontLabel: {
    fontSize: 11,
    color: '#484f58',
  },
  fontLabelActive: {
    color: '#ff4500',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#21262d',
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#0d1117',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#30363d',
    marginBottom: 24,
  },
  rowLabel: {
    fontSize: 15,
    color: '#e6edf3',
  },
  rowArrow: {
    fontSize: 20,
    color: '#8b949e',
  },
  comingSoon: {
    fontSize: 12,
    color: '#484f58',
  },
});
