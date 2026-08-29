import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal, StyleSheet,
  ActivityIndicator, Platform, KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { api, getV2User } from '../api/client';

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export default function SupportFab({ surface = 'mobile-lp' }) {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [shotMeta, setShotMeta] = useState('Optional: attach a screenshot');
  const [shot, setShot] = useState(null);

  const attach = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const uri = res.assets[0].uri;
      const r = await fetch(uri);
      const blob = await r.blob();
      const dataUrl = await blobToDataUrl(blob);
      setShot(dataUrl);
      setShotMeta(`Attached · ~${Math.round((String(dataUrl).length * 0.75) / 1024)} KB`);
    } catch (e) {
      setShotMeta(e?.message || 'Could not attach image');
    }
  };

  const submit = async () => {
    const text = desc.trim();
    if (text.length < 8) {
      setStatus('Please describe the issue in a sentence or two.');
      return;
    }
    setBusy(true);
    setStatus('Uploading ticket…');
    try {
      const me = (await getV2User()) || {};
      const j = await api.fileSupportTicket({
        description: text,
        page_url: `dga-mobile://${surface}`,
        page_path: `/${surface}`,
        active_tab: surface,
        user_agent: `DGA-mobile ${Platform.OS} ${Platform.Version}`,
        viewport: { w: 0, h: 0, dpr: 1, os: Platform.OS },
        console_errors: [],
        context: {
          theme: 'mobile',
          title: 'DGA Capital mobile',
          role: me.role || 'lp',
          user: me.email || me.lp_id || null,
          name: me.name || '',
        },
        screenshot_b64: shot || null,
        screenshot_mime: 'image/jpeg',
        priority: 'normal',
      });
      if (!j?.ok) throw new Error(j?.error || j?.detail || 'Submit failed');
      setStatus(`✓ Ticket ${j.id || ''} sent. The GP desk will take it from here.`);
      setDesc('');
      setShot(null);
      setTimeout(() => setOpen(false), 1600);
    } catch (e) {
      setStatus(`❌ ${e?.message || 'failed'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={styles.fab}
        onPress={() => { setStatus(''); setOpen(true); }}
        accessibilityLabel="File support ticket"
      >
        <Text style={styles.fabLabel}>SUPPORT</Text>
      </TouchableOpacity>
      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          style={styles.bd}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.card}>
            <Text style={styles.h}>Report a problem</Text>
            <Text style={styles.sub}>
              Describe what broke. Optionally attach a screenshot. The GP desk
              receives the ticket — you will not see a ticket list.
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <TextInput
                style={styles.ta}
                placeholder="e.g. Documents is blank; Performance YTD looks wrong…"
                placeholderTextColor="#8A95A8"
                value={desc}
                onChangeText={setDesc}
                multiline
                autoFocus
              />
              <TouchableOpacity style={styles.attach} onPress={attach}>
                <Ionicons name="image-outline" size={16} color="#0A1628" />
                <Text style={styles.attachTxt}>{shot ? 'Change screenshot' : 'Attach screenshot'}</Text>
              </TouchableOpacity>
              <Text style={styles.meta}>{shotMeta}</Text>
              <View style={styles.row}>
                <TouchableOpacity style={styles.cancel} onPress={() => setOpen(false)}>
                  <Text style={styles.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.go} onPress={submit} disabled={busy}>
                  {busy
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.goTxt}>Submit ticket</Text>}
                </TouchableOpacity>
              </View>
              {!!status && <Text style={styles.status}>{status}</Text>}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 88,
    zIndex: 50,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#0A1628',
    borderWidth: 1,
    borderColor: 'rgba(91,184,212,0.42)',
    borderRadius: 2,
    elevation: 0,
  },
  fabLabel: {
    color: '#8ec9db',
    fontWeight: '600',
    fontSize: 10,
    letterSpacing: 2.8,
    textTransform: 'uppercase',
  },
  bd: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    maxHeight: '88%',
  },
  h: { fontSize: 16, fontWeight: '800', color: '#0A1628', marginBottom: 6 },
  sub: { fontSize: 12, color: '#6a7890', lineHeight: 18, marginBottom: 10 },
  ta: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: '#E8ECF2',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    backgroundColor: '#F5F7FA',
    color: '#0A1628',
    textAlignVertical: 'top',
  },
  attach: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  attachTxt: { fontSize: 13, fontWeight: '700', color: '#0A1628' },
  meta: { fontSize: 11, color: '#8A95A8', marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  cancel: {
    height: 36, paddingHorizontal: 14, borderRadius: 8,
    borderWidth: 1, borderColor: '#E8ECF2', justifyContent: 'center',
  },
  cancelTxt: { fontWeight: '700', color: '#6a7890' },
  go: {
    height: 36, paddingHorizontal: 16, borderRadius: 8,
    backgroundColor: '#0A1628', justifyContent: 'center', minWidth: 120, alignItems: 'center',
  },
  goTxt: { color: '#fff', fontWeight: '800' },
  status: { marginTop: 10, fontSize: 12, color: '#3D4A5C' },
});
