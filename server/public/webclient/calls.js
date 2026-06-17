/* calls.js — 1:1 WebRTC voice/video calls in the browser. Signaling rides the
   existing socket (call-offer/answer/ice/ready/reject/end) with the *exact*
   payload shape the Flutter client uses, so web↔mobile calls interoperate.
   ICE servers come from GET /api/ice. UI overlay lives in #call-root. */

import { api } from './api.js';
import * as socket from './socket.js';
import * as prefs from './prefs.js';
import { el, clear, icon, avatar, toast } from './ui.js';

let active = null; // current call session
let wired = false;
const root = () => document.getElementById('call-root');

async function iceServers() {
  try { const r = await api.get('/ice'); return r.iceServers || []; }
  catch { return [{ urls: 'stun:stun.l.google.com:19302' }]; }
}

export function wireCalls() {
  if (wired) return; wired = true;
  socket.on('call-offer', onOffer);
  socket.on('call-answer', onAnswer);
  socket.on('call-ice', onIce);
  socket.on('call-ready', onReady);
  socket.on('call-reject', () => endLocal('Abgelehnt'));
  socket.on('call-end', () => endLocal('Anruf beendet'));
}

// ---- ringtones ------------------------------------------------------------
// Synthesised on the fly (no audio asset): a bright "ring-ring" for incoming
// calls, a calmer ringback while an outgoing call is still ringing. Controlled
// by the callRingtone preference and stopped the instant the call state moves
// on (answered / declined / ended).
let ringCtx = null;
let ringTimer = null;
function ringAudio() {
  try { ringCtx = ringCtx || new (window.AudioContext || window.webkitAudioContext)(); }
  catch { return null; }
  if (ringCtx.state === 'suspended') ringCtx.resume().catch(() => {});
  return ringCtx;
}
function ringBurst(ctx, freqs, dur) {
  const now = ctx.currentTime;
  for (const f of freqs) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.04);
    g.gain.setValueAtTime(0.16, now + Math.max(0.06, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(now); osc.stop(now + dur + 0.03);
  }
}
function startRingtone(mode) {
  if (!prefs.get('callRingtone')) return;
  stopRingtone();
  const ctx = ringAudio(); if (!ctx) return;
  const cycle = () => {
    if (mode === 'incoming') { ringBurst(ctx, [660, 550], 0.4); setTimeout(() => ringBurst(ctx, [660, 550], 0.4), 560); }
    else ringBurst(ctx, [440, 480], 0.9);
  };
  cycle();
  ringTimer = setInterval(cycle, mode === 'incoming' ? 2400 : 4000);
}
function stopRingtone() {
  if (ringTimer) { clearInterval(ringTimer); ringTimer = null; }
}

// ---- outgoing -------------------------------------------------------------
export async function startCall(peer, video) {
  if (active) { toast('Du bist bereits in einem Anruf.'); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
  } catch { toast('Kein Zugriff auf Mikrofon/Kamera.', 'err'); return; }

  active = newSession({ peer, video, outgoing: true, callId: String(Date.now()), localStream: stream });
  await makePeer();
  active.localStream.getTracks().forEach((t) => active.pc.addTrack(t, active.localStream));
  const offer = await active.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: video });
  await active.pc.setLocalDescription(offer);
  active.localOfferSdp = offer.sdp;
  socket.send('call-offer', { to: peer.id, callId: active.callId, sdp: offer.sdp, video });
  active.state = 'ringing';
  startRingtone('outgoing');
  renderCall();
}

// ---- incoming -------------------------------------------------------------
function onOffer(p) {
  // Re-offer for the same call (caller re-sent) → just refresh stored offer.
  if (active && active.callId === p.callId) { active.remoteOffer = p; return; }
  if (active) { socket.send('call-reject', { to: p.from.id, callId: p.callId, reason: 'busy' }); return; }
  active = newSession({ peer: p.from, video: p.video === true, outgoing: false,
    callId: p.callId, remoteOffer: p });
  active.state = 'incoming';
  startRingtone('incoming');
  renderCall();
}

async function accept() {
  if (!active || active.state !== 'incoming') return;
  stopRingtone();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: active.video });
  } catch { toast('Kein Zugriff auf Mikrofon/Kamera.', 'err'); return reject(); }
  active.localStream = stream;
  active.state = 'connecting';
  renderCall();
  await makePeer();
  stream.getTracks().forEach((t) => active.pc.addTrack(t, stream));
  await active.pc.setRemoteDescription({ type: 'offer', sdp: active.remoteOffer.sdp });
  active.remoteSet = true;
  await flushIce();
  const answer = await active.pc.createAnswer();
  await active.pc.setLocalDescription(answer);
  socket.send('call-answer', { to: active.peer.id, callId: active.callId, sdp: answer.sdp });
}

function reject() {
  if (!active) return;
  socket.send('call-reject', { to: active.peer.id, callId: active.callId, reason: 'declined' });
  endLocal();
}

async function onAnswer(p) {
  if (!active || !active.pc) return;
  stopRingtone();
  await active.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
  active.remoteSet = true;
  await flushIce();
  if (active.state === 'ringing') { active.state = 'connecting'; renderCall(); }
}

async function onIce(p) {
  if (!active || !p.candidate) return;
  const cand = { candidate: p.candidate.candidate, sdpMid: p.candidate.sdpMid,
    sdpMLineIndex: p.candidate.sdpMLineIndex };
  if (!active.pc || !active.remoteSet) active.pendingIce.push(cand);
  else { try { await active.pc.addIceCandidate(cand); } catch {} }
}

function onReady(p) {
  // Callee asks us (caller) to re-send the offer.
  if (active && active.outgoing && active.callId === p.callId && active.localOfferSdp) {
    socket.send('call-offer', { to: active.peer.id, callId: active.callId,
      sdp: active.localOfferSdp, video: active.video });
  }
}

// ---- peer connection ------------------------------------------------------
async function makePeer() {
  const pc = new RTCPeerConnection({ iceServers: await iceServers() });
  active.pc = pc;
  active.remoteStream = new MediaStream();
  pc.onicecandidate = (e) => {
    if (e.candidate && active) socket.send('call-ice', {
      to: active.peer.id, callId: active.callId,
      candidate: { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid,
        sdpMLineIndex: e.candidate.sdpMLineIndex },
    });
  };
  pc.ontrack = (e) => {
    e.streams[0]?.getTracks().forEach((t) => active.remoteStream.addTrack(t));
    if (active.state !== 'connected') { active.state = 'connected'; active.startedAt = Date.now(); stopRingtone(); }
    renderCall();
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) endLocal('Verbindung verloren');
  };
}

async function flushIce() {
  for (const c of active.pendingIce) { try { await active.pc.addIceCandidate(c); } catch {} }
  active.pendingIce = [];
}

function newSession(s) {
  return { pc: null, remoteStream: null, localStream: null, pendingIce: [], remoteSet: false,
    muted: false, camOff: false, state: 'init', startedAt: 0, ...s };
}

function hangup() {
  if (!active) return;
  socket.send(active.outgoing ? 'call-end' : 'call-end', { to: active.peer.id, callId: active.callId });
  endLocal();
}

function endLocal(reason) {
  if (!active) return;
  stopRingtone();
  try { active.pc?.close(); } catch {}
  active.localStream?.getTracks().forEach((t) => t.stop());
  active = null;
  clear(root());
  if (reason) toast(reason);
}

// ---- controls -------------------------------------------------------------
function toggleMute() {
  if (!active?.localStream) return;
  active.muted = !active.muted;
  active.localStream.getAudioTracks().forEach((t) => (t.enabled = !active.muted));
  renderCall();
}
function toggleCam() {
  if (!active?.localStream) return;
  active.camOff = !active.camOff;
  active.localStream.getVideoTracks().forEach((t) => (t.enabled = !active.camOff));
  renderCall();
}

// ---- UI -------------------------------------------------------------------
let durTimer = null;
function renderCall() {
  const r = root();
  clear(r);
  clearInterval(durTimer);
  if (!active) return;

  const overlay = el('div', { class: 'call-overlay' });

  if (active.video && (active.state === 'connected' || active.state === 'connecting')) {
    const remote = el('video', { class: 'remote', autoplay: 'autoplay', playsinline: 'playsinline' });
    remote.srcObject = active.remoteStream;
    const local = el('video', { class: 'local', autoplay: 'autoplay', muted: 'muted', playsinline: 'playsinline' });
    local.srcObject = active.localStream;
    overlay.appendChild(el('div', { class: 'call-videos' }, [remote, local]));
  } else {
    overlay.appendChild(avatar(active.peer, 120, { kind: 'user' }));
  }

  overlay.appendChild(el('div', { class: 'cname', text: active.peer.displayName }));
  const stateLine = el('div', { class: 'cstate' });
  overlay.appendChild(stateLine);
  const setState = () => {
    stateLine.textContent = active.state === 'incoming'
      ? (active.video ? 'Eingehender Videoanruf …' : 'Eingehender Anruf …')
      : active.state === 'ringing' ? 'Klingelt …'
      : active.state === 'connecting' ? 'Verbindet …'
      : duration();
  };
  setState();
  if (active.state === 'connected') durTimer = setInterval(setState, 1000);

  // hidden audio sink for voice calls
  if (!active.video && active.remoteStream) {
    const a = el('audio', { autoplay: 'autoplay' }); a.srcObject = active.remoteStream;
    overlay.appendChild(a);
  }

  let actions;
  if (active.state === 'incoming') {
    actions = [
      callBtn('phone', 'accept', accept, 'Annehmen'),
      callBtn('close', 'end', reject, 'Ablehnen'),
    ];
  } else {
    actions = [
      callBtn(active.muted ? 'micOff' : 'mic', '', toggleMute, 'Mikro'),
      active.video ? callBtn(active.camOff ? 'videoOff' : 'video', '', toggleCam, 'Kamera') : null,
      callBtn('close', 'end', hangup, 'Auflegen'),
    ].filter(Boolean);
  }
  overlay.appendChild(el('div', { class: 'call-actions' }, actions));
  r.appendChild(overlay);
}

function callBtn(ic, cls, onClick, title) {
  return el('button', { class: `call-btn ${cls}`, title, onClick }, icon(ic));
}

function duration() {
  const s = Math.floor((Date.now() - active.startedAt) / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
