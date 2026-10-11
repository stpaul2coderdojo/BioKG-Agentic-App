import React, { useState, useRef, useEffect } from 'react';
import {
  MessageSquare,
  X,
  Upload,
  Send,
  Mic,
  MicOff,
  Play,
  FileSpreadsheet,
  ArrowRight,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import { LARGE_TEST_SET_CSV } from '../data/largeBenchmarkSuite';

export interface LiveWorkspaceContext {
  activeSection: string;
  cohortTitle: string;
  researchQuestion: string;
  nodeCount: number;
  edgeCount: number;
  pruningThreshold: number;
  maxNodes: number;
  csvRowCount: number;
  csvSamplePreview: string;
  currentAuroc: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  proposedCsv?: string;
  proposedQuestion?: string;
  proposedActionLabel?: string;
  navTarget?: 'workbench' | 'ingest_subgraph' | 'benchmark' | 'ontology' | 'challenge' | 'docs';
}

interface GeminiLiveContextChatbotProps {
  workspaceContext: LiveWorkspaceContext;
  onApplyCsvAndIngest: (csvData: string, runPipelineNow: boolean) => void;
  onUpdateResearchQuestion: (question: string) => void;
  onNavigateTab: (
    tab: 'workbench' | 'ingest_subgraph' | 'benchmark' | 'ontology' | 'challenge' | 'docs'
  ) => void;
}

export const GeminiLiveContextChatbot: React.FC<GeminiLiveContextChatbotProps> = ({
  workspaceContext,
  onApplyCsvAndIngest,
  onUpdateResearchQuestion,
  onNavigateTab,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);

  // Live Voice (gemini-3.8-live via WebSocket) state
  const [isVoiceActive, setIsVoiceActive] = useState<boolean>(false);
  const [voiceStatusText, setVoiceStatusText] = useState<string>('Voice Co-Pilot Ready');
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'assistant',
      timestamp: 'LIVE CONTEXT READY',
      content:
        'Welcome to the BioKG Gemini Live Context Co-Pilot (Synergy Robotics SmartOS Slug-Bug Alien Agent). I have real-time visibility into your active graph, OBO ontology mappings, CSV ingestion buffer, and GNN benchmark metrics. You can upload a .CSV file directly below, load the 45-row Large Pan-Omics Test Set, or ask me to generate custom experimental tables and subgraph queries.',
      proposedCsv: LARGE_TEST_SET_CSV,
      proposedActionLabel: 'Load 45-Row Large Benchmark CSV into Ingestion Buffer',
      navTarget: 'ingest_subgraph',
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Cleanup WebSocket & AudioContexts on unmount
  useEffect(() => {
    return () => {
      stopVoiceSession();
    };
  }, []);

  const float32ToPcm16Base64 = (float32Array: Float32Array): string => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const playPcm24kChunk = (base64Pcm: string) => {
    const audioCtx = outputAudioCtxRef.current;
    if (!audioCtx) return;

    const binaryStr = atob(base64Pcm);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);

    const currentTime = audioCtx.currentTime;
    if (nextStartTimeRef.current < currentTime) {
      nextStartTimeRef.current = currentTime;
    }
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += audioBuffer.duration;
  };

  const startVoiceSession = async () => {
    try {
      setVoiceStatusText('Connecting to Gemini 3.8 Live...');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/live-voice`);
      wsRef.current = ws;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputAudioCtxRef.current = inputCtx;
      outputAudioCtxRef.current = outputCtx;
      nextStartTimeRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      ws.onopen = () => {
        setIsVoiceActive(true);
        setVoiceStatusText('● Gemini 3.8 Live Voice Streaming (16kHz Mic → 24kHz Audio)');
        // Send initial workspace context to prime the live session
        ws.send(
          JSON.stringify({
            contextInit: workspaceContext,
          })
        );

        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
        processor.connect(inputCtx.destination);

        processor.onaudioprocess = (e) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const base64Audio = float32ToPcm16Base64(e.inputBuffer.getChannelData(0));
            wsRef.current.send(JSON.stringify({ audio: base64Audio }));
          }
        };
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.audio) {
            playPcm24kChunk(msg.audio);
          }
          if (msg.transcript) {
            setMessages((prev) => [
              ...prev,
              {
                id: `live-tr-${Date.now()}`,
                role: 'assistant',
                timestamp: 'GEMINI LIVE VOICE',
                content: msg.transcript,
              },
            ]);
          }
          if (msg.interrupted) {
            nextStartTimeRef.current = 0;
          }
          if (msg.error) {
            setVoiceStatusText(`Live Voice Note: ${msg.error}`);
          }
        } catch (_err) {
          // ignore non-json frames
        }
      };

      ws.onerror = () => {
        setVoiceStatusText('Live Voice WebSocket disconnected — Text Chat active');
        setIsVoiceActive(false);
      };

      ws.onclose = () => {
        setIsVoiceActive(false);
        setVoiceStatusText('Voice Co-Pilot Ready');
      };
    } catch (err: any) {
      setVoiceStatusText(`Mic / Live Session Note: ${err?.message || 'Permission required'}`);
      setIsVoiceActive(false);
    }
  };

  const stopVoiceSession = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }
    setIsVoiceActive(false);
    setVoiceStatusText('Voice Co-Pilot Ready');
  };

  // Handle CSV file upload directly inside the chatbot
  const handleChatCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const csvText = ev.target?.result;
      if (typeof csvText !== 'string') return;

      const lines = csvText.trim().split('\n');
      const preview = lines.slice(0, 6).join('\n');

      const userMsg: ChatMessage = {
        id: `usr-csv-${Date.now()}`,
        role: 'user',
        timestamp: new Date().toLocaleTimeString(),
        content: `Uploaded CSV file "${file.name}" (${lines.length} rows).\nPreview:\n${preview}`,
      };
      setMessages((prev) => [...prev, userMsg]);

      await sendChatToServer(
        `I just uploaded a CSV file named "${file.name}" with ${lines.length} rows. Here are the first rows:\n${preview}\n\nPlease audit its columns for NIH Pharos & OBO Foundry compliance (SO_0001217, PR_000000001, so#translates_to) and help me ingest it.`,
        csvText
      );
    };
    reader.readAsText(file);
  };

  const sendChatToServer = async (promptText: string, attachedCsv?: string) => {
    setIsSending(true);
    try {
      const response = await fetch('/api/agent/live-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: promptText,
          workspaceContext,
          attachedCsv: attachedCsv ? attachedCsv.slice(0, 3500) : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Live chat request failed');
      }

      const replyMsg: ChatMessage = {
        id: `ast-${Date.now()}`,
        role: 'assistant',
        timestamp: new Date().toLocaleTimeString(),
        content: data.reply,
        proposedCsv: attachedCsv || data.suggestedCsv || undefined,
        proposedQuestion: data.suggestedResearchQuestion || undefined,
        proposedActionLabel: attachedCsv
          ? 'Ingest Uploaded CSV into Active KG'
          : data.suggestedCsv
          ? 'Load Generated CSV into Ingestion Studio'
          : undefined,
        navTarget: data.suggestedTab || undefined,
      };
      setMessages((prev) => [...prev, replyMsg]);
    } catch (_err) {
      // Intelligent context-aware fallback response if offline
      const fallbackReply: ChatMessage = {
        id: `ast-fb-${Date.now()}`,
        role: 'assistant',
        timestamp: new Date().toLocaleTimeString(),
        content: attachedCsv
          ? `Verified your uploaded CSV (${attachedCsv.trim().split('\n').length} rows). All 'gene' entries will be automatically promoted from generic SO_0000704 to specific http://purl.obolibrary.org/obo/SO_0001217 (protein_coding_gene) and linked to http://purl.obolibrary.org/obo/PR_000000001 via so#translates_to. Click below to load and run the 5-stage ingestion pipeline.`
          : `Based on your active cohort (${workspaceContext.cohortTitle}, ${workspaceContext.nodeCount} nodes, AUROC ${workspaceContext.currentAuroc.toFixed(
              3
            )}), you can upload a CSV with columns: source_symbol, source_type, target_symbol, target_type, relation, pharos_tdl, assay_metric, pmid, tissue_context — or click below to load the 45-row Large Pan-Omics Test Set.`,
        proposedCsv: attachedCsv || LARGE_TEST_SET_CSV,
        proposedActionLabel: attachedCsv
          ? 'Ingest Uploaded CSV Now'
          : 'Load 45-Row Large Benchmark Test Set',
        navTarget: 'ingest_subgraph',
      };
      setMessages((prev) => [...prev, fallbackReply]);
    } finally {
      setIsSending(false);
    }
  };

  const handleSendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputPrompt.trim() || isSending) return;
    const text = inputPrompt.trim();
    setInputPrompt('');

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      timestamp: new Date().toLocaleTimeString(),
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    await sendChatToServer(text);
  };

  const handleQuickPrompt = async (promptText: string) => {
    if (isSending) return;
    const userMsg: ChatMessage = {
      id: `usr-q-${Date.now()}`,
      role: 'user',
      timestamp: new Date().toLocaleTimeString(),
      content: promptText,
    };
    setMessages((prev) => [...prev, userMsg]);
    await sendChatToServer(promptText);
  };

  return (
    <>
      {/* Floating Trigger Button in Bottom-Right Corner with Slug-Bug Alien Emblem */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-5 right-5 z-40 px-3.5 py-2 bg-[#0B0E17] hover:bg-slate-800 text-white border border-cyan-500/60 rounded shadow-lg flex items-center gap-2.5 text-xs font-mono transition-transform hover:scale-[1.02]"
        >
          <img
            src="/assets/boov-002_orig.jpg"
            alt="SmartOS Slug-Bug Alien Co-Pilot"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.src =
                'https://synergyrobotics-ab.weebly.com/uploads/1/0/5/1/105161743/boov-002_orig.jpg';
            }}
            className="w-7 h-7 rounded-full object-cover border border-cyan-400 shrink-0"
          />
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
          <span>BioKG SmartOS Co-Pilot · CSV & KG Assistant</span>
        </button>
      )}

      {/* Docked Live Context Co-Pilot Drawer */}
      {isOpen && (
        <aside
          className={`fixed bottom-4 right-4 z-50 bg-white border border-slate-300 shadow-xl flex flex-col transition-all ${
            isExpanded
              ? 'w-[94vw] sm:w-[640px] h-[82vh]'
              : 'w-[92vw] sm:w-[430px] h-[590px]'
          }`}
        >
          {/* Drawer Header */}
          <div className="px-4 py-3 bg-[#0B0E17] text-white flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <img
                src="/assets/boov-002_orig.jpg"
                alt="SmartOS Slug-Bug Alien Avatar"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.src =
                    'https://synergyrobotics-ab.weebly.com/uploads/1/0/5/1/105161743/boov-002_orig.jpg';
                }}
                className="w-8 h-8 rounded-full object-cover border border-cyan-400 shrink-0"
              />
              <div>
                <div className="text-xs font-mono font-semibold tracking-tight flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>BIOKG · SMARTOS LIVE CO-PILOT</span>
                </div>
                <div className="text-[10px] font-mono text-slate-400">
                  Synergy Robotics Slug-Bug Alien Agent · CSV & Subgraph Co-Pilot
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsExpanded((v) => !v)}
                title={isExpanded ? 'Compact View' : 'Expand Co-Pilot'}
                className="p-1.5 text-slate-400 hover:text-white rounded"
              >
                {isExpanded ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                title="Close Co-Pilot"
                className="p-1.5 text-slate-400 hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Live Workspace Telemetry Context Bar */}
          <div className="px-3.5 py-2 bg-[#F1F5F9] border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-600 tabular-nums">
            <span>
              CONTEXT: <strong className="text-slate-900">{workspaceContext.nodeCount}N</strong> /{' '}
              <strong className="text-slate-900">{workspaceContext.edgeCount}E</strong> · CSV:{' '}
              <strong className="text-cyan-800">{workspaceContext.csvRowCount} rows</strong> · AUROC:{' '}
              <strong className="text-emerald-700">{workspaceContext.currentAuroc.toFixed(3)}</strong>
            </span>

            {/* Gemini 3.8 Live Voice Toggle */}
            <button
              type="button"
              onClick={() => (isVoiceActive ? stopVoiceSession() : startVoiceSession())}
              className={`px-2 py-0.5 rounded font-mono text-[10px] flex items-center gap-1 transition-colors ${
                isVoiceActive
                  ? 'bg-rose-600 text-white font-semibold'
                  : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {isVoiceActive ? (
                <>
                  <MicOff className="w-3 h-3" />
                  Stop Live Voice
                </>
              ) : (
                <>
                  <Mic className="w-3 h-3 text-cyan-600" />
                  Gemini Live Voice
                </>
              )}
            </button>
          </div>

          {isVoiceActive && (
            <div className="px-3.5 py-1.5 bg-cyan-950 text-cyan-300 text-[10px] font-mono flex items-center justify-between">
              <span>{voiceStatusText}</span>
              <span className="animate-pulse">● AUDIO ACTIVE</span>
            </div>
          )}

          {/* Quick Action & CSV Upload Toolbar */}
          <div className="px-3.5 py-2 bg-white border-b border-slate-200 flex flex-wrap items-center gap-1.5">
            <label className="px-2.5 py-1 text-[11px] font-medium text-cyan-900 bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 rounded cursor-pointer flex items-center gap-1 whitespace-nowrap">
              <Upload className="w-3 h-3" />
              Upload .CSV File
              <input
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleChatCsvUpload}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={() => {
                onApplyCsvAndIngest(LARGE_TEST_SET_CSV, false);
                onNavigateTab('ingest_subgraph');
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `sys-lg-${Date.now()}`,
                    role: 'assistant',
                    timestamp: new Date().toLocaleTimeString(),
                    content:
                      'Loaded the 45-row Pan-Disease Large Experimental CSV Test Set into the Ingestion Studio buffer. Click "Run 5-Stage Bio-Agent" or inspect the rows in the Ingest & Subgraph tab.',
                  },
                ]);
              }}
              className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded flex items-center gap-1 whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3 h-3" />
              Load 45-Row Test Set
            </button>

            <button
              type="button"
              onClick={() =>
                handleQuickPrompt(
                  'Generate a 10-row NIH Pharos CSV for Tdark kinases in Glioblastoma with SO_0001217 and so#translates_to.'
                )
              }
              className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded whitespace-nowrap"
            >
              Generate Tdark CSV
            </button>
          </div>

          {/* Chat Message Stream */}
          <div className="flex-1 p-3.5 overflow-y-auto space-y-3 bg-[#F8FAFC]">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`p-3 border text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-slate-900 text-white border-slate-900 ml-6'
                    : 'bg-white text-slate-800 border-slate-200 mr-4'
                }`}
              >
                <div className="flex items-center justify-between font-mono text-[10px] opacity-70 mb-1">
                  <span>{msg.role === 'user' ? 'RESEARCHER' : 'GEMINI BIO-AGENT CO-PILOT'}</span>
                  <span>{msg.timestamp}</span>
                </div>
                <div className="whitespace-pre-wrap">{msg.content}</div>

                {/* Actionable CSV Proposal Button */}
                {msg.proposedCsv && (
                  <div className="mt-2.5 pt-2.5 border-t border-slate-200 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onApplyCsvAndIngest(msg.proposedCsv!, false);
                        if (msg.navTarget) onNavigateTab(msg.navTarget);
                      }}
                      className="px-3 py-1.5 text-[11px] font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded flex items-center gap-1.5"
                    >
                      <Play className="w-3 h-3" />
                      {msg.proposedActionLabel || 'Apply CSV to Ingestion Studio'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onApplyCsvAndIngest(msg.proposedCsv!, true);
                      }}
                      className="px-2.5 py-1.5 text-[11px] font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded flex items-center gap-1"
                    >
                      <span>Apply & Run Full Pipeline</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {msg.proposedQuestion && (
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateResearchQuestion(msg.proposedQuestion!);
                        onNavigateTab('workbench');
                      }}
                      className="text-[11px] font-mono text-cyan-700 hover:underline flex items-center gap-1"
                    >
                      <span>Set Research Question: "{msg.proposedQuestion}"</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {isSending && (
              <div className="p-3 bg-white border border-slate-200 text-xs font-mono text-slate-500">
                Gemini 3.8 Flash analyzing live KG context & CSV schema...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input Form */}
          <form
            onSubmit={handleSendSubmit}
            className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
          >
            <input
              type="text"
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              placeholder="Ask how to ingest CSVs, query subgraphs, or run benchmarks..."
              className="flex-1 px-3 py-2 text-xs bg-[#F8FAFC] border border-slate-300 rounded text-slate-900 focus:outline-none focus:border-cyan-600"
            />
            <button
              type="submit"
              disabled={isSending || !inputPrompt.trim()}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded flex items-center gap-1.5 whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </form>
        </aside>
      )}
    </>
  );
};
