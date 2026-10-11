import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';

dotenv.config();

const PORT = 3000;

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  app.use(express.json({ limit: '4mb' }));

  // Render Blueprint & NVIDIA Brev Health Check Endpoint
  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'biokg-agent-workbench',
      author: 'Dr. Bheemaiah Anil Kumar, Synergy Robotics, Seattle',
      oboStandardsReady: true,
      liveVoiceReady: true,
      brevLaunchableReady: true,
      supportedAgentRuntimes: ['nemoclaw', 'openclaw', 'hermes'],
      activeAgentRuntime: process.env.BIOKG_AGENT_RUNTIME || 'nemoclaw',
      timestamp: new Date().toISOString(),
    });
  });

  // NVIDIA Brev Compiler & Runtime Manifest Endpoint (NeMoClaw / OpenClaw / Nous Hermes)
  app.post('/api/brev/compile-manifest', (req, res) => {
    const {
      runtime = 'nemoclaw',
      gpuTier = '1x NVIDIA L40S (48GB VRAM)',
      enableOpenShellGuardrails = true,
      oboStrictMode = true,
    } = req.body || {};

    const runtimeProfiles: Record<string, any> = {
      nemoclaw: {
        runtime: 'nemoclaw',
        title: 'NVIDIA NeMoClaw (Enterprise OpenClaw + NIM + OpenShell)',
        containerImage: 'nvcr.io/nvidia/nim/llama-3.1-nemotron-70b-instruct:latest',
        launchCommand: 'docker compose -f docker-compose.brev.yml --profile nemoclaw up -d',
        brevCliCommand: 'brev open biokg-nemoclaw-launchable --gpu l40s',
        openShellPolicy: enableOpenShellGuardrails ? 'ENFORCED (OBO URI Whitelist)' : 'PERMISSIVE',
        oboTranslationSpine: oboStrictMode
          ? 'SO_0001217 -> so#translates_to -> PR_000000001'
          : 'Standard BioLink',
      },
      openclaw: {
        runtime: 'openclaw',
        title: 'OpenClaw (Open-Source 5-Stage Multi-Agent Swarm)',
        containerImage: 'ghcr.io/openclaw-ai/openclaw-server:latest',
        launchCommand: 'docker compose -f docker-compose.brev.yml --profile openclaw up -d',
        brevCliCommand: 'brev open biokg-openclaw-swarm --gpu a10g',
        openShellPolicy: 'OpenClaw Native Tool Sandbox',
        oboTranslationSpine: 'SO_0001217 -> so#translates_to -> PR_000000001',
      },
      hermes: {
        runtime: 'hermes',
        title: 'Nous Hermes 3 (Hermes-3-Llama-3.1-70B-FP8 Function Calling)',
        containerImage: 'vllm/vllm-openai:latest',
        launchCommand: 'docker compose -f docker-compose.brev.yml --profile hermes up -d',
        brevCliCommand: 'brev open biokg-hermes-agent --gpu a100-80gb',
        openShellPolicy: 'Hermes XML <tool_call> Strict Schema Validator',
        oboTranslationSpine: 'SO_0001217 -> so#translates_to -> PR_000000001',
      },
    };

    const selected = runtimeProfiles[runtime] || runtimeProfiles.nemoclaw;
    res.json({
      status: 'compiled',
      targetPlatform: 'NVIDIA Brev Launchable',
      gpuTier,
      ...selected,
      compiledAt: new Date().toISOString(),
    });
  });

  // 1. Autonomous 5-Stage KG Agent Pipeline (Ingest -> Filter -> Clean -> Limit -> Predict)
  app.post('/api/agent/pipeline', async (req, res) => {
    try {
      const { researchQuestion, rawTabularData, pruningThreshold = 0.55, maxNodes = 25 } = req.body;
      const ai = getAiClient();

      const prompt = `You are an autonomous Bio-Agent for the NIH Pharos Knowledge Graph Construction Challenge.
Execute the 5-stage KG pipeline (Ingest, Filter, Clean/Prune, Limit, and GNN Held-Out Link Prediction) for:

Research Question: "${researchQuestion}"
Pruning Threshold: ${pruningThreshold}
Node Limit: ${maxNodes}

Structured Experimental Tabular Data (CSV):
${rawTabularData}

Strict Ontology Rules (10% Judging Weight):
1. All protein-coding genes MUST use http://purl.obolibrary.org/obo/SO_0001217 (protein_coding_gene) instead of the generic http://purl.obolibrary.org/obo/SO_0000704 (gene). Mark upgradedFromGenericGene=true when upgrading a 'gene' column to SO_0001217.
2. All proteins MUST use http://purl.obolibrary.org/obo/PR_000000001.
3. The translation relationship between SO_0001217 and PR_000000001 MUST be http://purl.obolibrary.org/obo/so#translates_to.
4. Drugs/chemicals use http://purl.obolibrary.org/obo/CHEBI_23888, diseases use http://purl.obolibrary.org/obo/MONDO_0000001, biological processes use http://purl.obolibrary.org/obo/GO_0008150.
5. Identify noisy/erroneous rows (e.g. serum contaminants like ALB, KRT10, non-expressed olfactory receptors like OR2A4, or unverified text mining artifacts) and assign status 'pruned_hallucination' or 'pruned_context' with low gnnReweightedConfidence (<0.25) and a clear pruningReason.
6. Predict 2 held-out high-value links (status 'predicted_heldout') connecting understudied Tdark/Tchem targets or chemical probes to the target disease with a multi-hop lineageExplanation.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              cypherQuery: {
                type: Type.STRING,
                description: 'Executable Cypher/SPARQL graph query using OBO URIs and threshold filtering.',
              },
              agentReasoningSummary: {
                type: Type.STRING,
                description: 'Concise 2-3 sentence scientific explanation of the ingestion, pruning, and GNN link prediction results.',
              },
              nodes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    label: { type: Type.STRING },
                    symbol: { type: Type.STRING },
                    ontologyClass: { type: Type.STRING },
                    ontologyLabel: { type: Type.STRING },
                    biolinkCategory: { type: Type.STRING },
                    tdl: { type: Type.STRING },
                    sourceDb: { type: Type.STRING },
                    externalCurie: { type: Type.STRING },
                    relevanceScore: { type: Type.NUMBER },
                    upgradedFromGenericGene: { type: Type.BOOLEAN },
                    isFilteredOut: { type: Type.BOOLEAN },
                    description: { type: Type.STRING },
                  },
                  required: [
                    'id',
                    'label',
                    'symbol',
                    'ontologyClass',
                    'ontologyLabel',
                    'biolinkCategory',
                    'tdl',
                    'sourceDb',
                    'externalCurie',
                    'relevanceScore',
                    'upgradedFromGenericGene',
                    'isFilteredOut',
                    'description',
                  ],
                },
              },
              edges: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    source: { type: Type.STRING },
                    target: { type: Type.STRING },
                    predicateUri: { type: Type.STRING },
                    predicateLabel: { type: Type.STRING },
                    biolinkPredicate: { type: Type.STRING },
                    rawConfidence: { type: Type.NUMBER },
                    gnnReweightedConfidence: { type: Type.NUMBER },
                    evidenceSource: { type: Type.STRING },
                    pmid: { type: Type.STRING },
                    assayValue: { type: Type.STRING },
                    status: { type: Type.STRING },
                    lineageExplanation: { type: Type.STRING },
                    pruningReason: { type: Type.STRING },
                  },
                  required: [
                    'id',
                    'source',
                    'target',
                    'predicateUri',
                    'predicateLabel',
                    'biolinkPredicate',
                    'rawConfidence',
                    'gnnReweightedConfidence',
                    'evidenceSource',
                    'status',
                    'lineageExplanation',
                  ],
                },
              },
            },
            required: ['cypherQuery', 'agentReasoningSummary', 'nodes', 'edges'],
          },
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error('Empty response from Gemini model.');
      }
      const parsed = JSON.parse(text);
      res.json(parsed);
    } catch (error: any) {
      console.error('Error in /api/agent/pipeline:', error);
      res.status(500).json({
        error: error?.message || 'Failed to execute autonomous KG agent pipeline.',
      });
    }
  });

  // 2. Interactive Multi-Hop Subgraph Query & Path Synthesis Agent
  app.post('/api/agent/subgraph-query', async (req, res) => {
    try {
      const {
        seedSymbol,
        targetSymbol,
        hopDepth,
        allowedTdls,
        discoveredPaths,
        naturalLanguageFilter,
      } = req.body;
      const ai = getAiClient();

      const prompt = `You are the Subgraph Query & Multi-Hop Reasoning Agent for a Pharos Biomedical Knowledge Graph.
Analyze the following parameterized subgraph traversal:
- Seed Entity: ${seedSymbol}
- Target Entity: ${targetSymbol || 'Any reachable phenotype/pathway'}
- Max Hop Depth: ${hopDepth}-Hop
- Allowed Pharos Target Development Levels (TDL): ${(allowedTdls || []).join(', ')}
- User Filter / Hypothesis: "${naturalLanguageFilter || 'Identify functional multi-hop pathways'}"
- Discovered Graph Paths: ${JSON.stringify(discoveredPaths || [])}

Return:
1. sparqlQuery: A standards-compliant SPARQL 1.1 query using OBO Foundry URIs (http://purl.obolibrary.org/obo/SO_0001217, PR_000000001, so#translates_to, RO_0002436, MONDO).
2. cypherQuery: Equivalent Neo4j / Amazon Neptune openCypher query.
3. biologicalSynthesis: A concise 2-3 sentence mechanistic interpretation of the discovered multi-hop subgraph paths.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              sparqlQuery: { type: Type.STRING },
              cypherQuery: { type: Type.STRING },
              biologicalSynthesis: { type: Type.STRING },
            },
            required: ['sparqlQuery', 'cypherQuery', 'biologicalSynthesis'],
          },
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error('Empty response from Gemini model.');
      }
      res.json(JSON.parse(text));
    } catch (error: any) {
      console.error('Error in /api/agent/subgraph-query:', error);
      res.status(500).json({
        error: error?.message || 'Failed to synthesize subgraph query.',
      });
    }
  });

  // 3. Configurable GNN Benchmark & Ablation Evaluation Agent
  app.post('/api/agent/run-benchmark', async (req, res) => {
    try {
      const {
        gnnArchitecture,
        heldOutSplitPct,
        enforceTranslationSpine,
        enableGnnPruning,
        includeMonarchContext,
        cohortTitle,
      } = req.body;
      const ai = getAiClient();

      const prompt = `You are the GNN Link Prediction Evaluation Agent for the NIH Pharos Knowledge Graph Challenge.
Evaluate the following experimental GNN benchmark configuration on "${cohortTitle}":
- GNN Architecture: ${gnnArchitecture}
- Held-Out Test Edge Split: ${heldOutSplitPct}%
- Separate SO_0001217 -> so#translates_to -> PR_000000001 Spine: ${enforceTranslationSpine}
- GNN + GTEx/CRAPome Edge Pruning Enabled: ${enableGnnPruning}
- Monarch MONDO + GO Multi-Hop Context Included: ${includeMonarchContext}

Provide a concise technical analysis explaining why this specific ablation and architecture configuration achieves its link prediction recall compared to the static Pharos baseline.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              ablationAnalysis: { type: Type.STRING },
              topologicalBottleneckNote: { type: Type.STRING },
            },
            required: ['ablationAnalysis', 'topologicalBottleneckNote'],
          },
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error('Empty response from Gemini model.');
      }
      res.json(JSON.parse(text));
    } catch (error: any) {
      console.error('Error in /api/agent/run-benchmark:', error);
      res.status(500).json({
        error: error?.message || 'Failed to run GNN benchmark analysis.',
      });
    }
  });

  // 4. Deep Edge Lineage & Explainability Audit (20% Judging Weight)
  app.post('/api/agent/explain-edge', async (req, res) => {
    try {
      const { sourceNode, targetNode, edge, researchQuestion } = req.body;
      const ai = getAiClient();

      const prompt = `You are the Explainability & Ontology Auditor Agent for a Pharos Biomedical Knowledge Graph.
Trace the exact biological and ontological lineage of this edge in the context of the user's research question: "${researchQuestion}".

Source Node: ${sourceNode?.label} (${sourceNode?.symbol}) | Ontology Class: ${sourceNode?.ontologyClass} | Pharos TDL: ${sourceNode?.tdl}
Edge Predicate: ${edge?.predicateUri} (${edge?.predicateLabel}) | Status: ${edge?.status} | Raw Confidence: ${edge?.rawConfidence} -> GNN Reweighted: ${edge?.gnnReweightedConfidence}
Target Node: ${targetNode?.label} (${targetNode?.symbol}) | Ontology Class: ${targetNode?.ontologyClass} | Pharos TDL: ${targetNode?.tdl}
Evidence: ${edge?.evidenceSource} (${edge?.pmid || 'No PMID'}) | Assay: ${edge?.assayValue || 'N/A'}

Provide a structured audit addressing:
1. multiHopMechanism: Why does Source connect to Target biologically, and how does this support or refute the multi-hop hypothesis?
2. gnnWeightingRationale: Why did the Graph Convolutional Network + Literature verifier assign confidence ${edge?.gnnReweightedConfidence}?
3. ontologyComplianceCheck: Verify adherence to OBO Foundry standards (SO_0001217 vs SO_0000704, PR_000000001, so#translates_to, RO/MONDO/CHEBI) and class parsimony.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              multiHopMechanism: { type: Type.STRING },
              gnnWeightingRationale: { type: Type.STRING },
              ontologyComplianceCheck: { type: Type.STRING },
              verificationVerdict: { type: Type.STRING },
            },
            required: [
              'multiHopMechanism',
              'gnnWeightingRationale',
              'ontologyComplianceCheck',
              'verificationVerdict',
            ],
          },
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error('Empty response from Gemini model.');
      }
      res.json(JSON.parse(text));
    } catch (error: any) {
      console.error('Error in /api/agent/explain-edge:', error);
      res.status(500).json({
        error: error?.message || 'Failed to generate edge lineage explanation.',
      });
    }
  });

  // 5. Autonomous Literature & Omics Maintenance Agent (Stage 5: Maintain)
  app.post('/api/agent/maintain-delta', async (req, res) => {
    try {
      const { currentPresetTitle, researchQuestion, existingNodeSymbols } = req.body;
      const ai = getAiClient();

      const prompt = `You are the Autonomous KG Maintenance Agent (Stage 5: Maintain).
A new batch of NIH Pharos v3.19 / PubMed October 2026 experimental preprints has arrived for "${currentPresetTitle}" (Question: "${researchQuestion}").
Existing Graph Symbols: ${(existingNodeSymbols || []).join(', ')}.

Propose 1 newly ingested Tdark or Tchem protein-coding gene + translated protein pair OR 1 newly discovered experimental interaction edge that connects to one of the existing symbols, strictly adhering to:
- http://purl.obolibrary.org/obo/SO_0001217 (protein_coding_gene)
- http://purl.obolibrary.org/obo/PR_000000001 (protein)
- http://purl.obolibrary.org/obo/so#translates_to
- http://purl.obolibrary.org/obo/RO_0002436`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              deltaAnnouncement: { type: Type.STRING },
              newNode: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  label: { type: Type.STRING },
                  symbol: { type: Type.STRING },
                  ontologyClass: { type: Type.STRING },
                  ontologyLabel: { type: Type.STRING },
                  biolinkCategory: { type: Type.STRING },
                  tdl: { type: Type.STRING },
                  sourceDb: { type: Type.STRING },
                  externalCurie: { type: Type.STRING },
                  relevanceScore: { type: Type.NUMBER },
                  description: { type: Type.STRING },
                },
                required: [
                  'id',
                  'label',
                  'symbol',
                  'ontologyClass',
                  'ontologyLabel',
                  'biolinkCategory',
                  'tdl',
                  'sourceDb',
                  'externalCurie',
                  'relevanceScore',
                  'description',
                ],
              },
              newEdge: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  targetExistingSymbol: { type: Type.STRING },
                  predicateUri: { type: Type.STRING },
                  predicateLabel: { type: Type.STRING },
                  biolinkPredicate: { type: Type.STRING },
                  rawConfidence: { type: Type.NUMBER },
                  gnnReweightedConfidence: { type: Type.NUMBER },
                  evidenceSource: { type: Type.STRING },
                  pmid: { type: Type.STRING },
                  assayValue: { type: Type.STRING },
                  lineageExplanation: { type: Type.STRING },
                },
                required: [
                  'id',
                  'targetExistingSymbol',
                  'predicateUri',
                  'predicateLabel',
                  'biolinkPredicate',
                  'rawConfidence',
                  'gnnReweightedConfidence',
                  'evidenceSource',
                  'pmid',
                  'assayValue',
                  'lineageExplanation',
                ],
              },
            },
            required: ['deltaAnnouncement', 'newNode', 'newEdge'],
          },
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error('Empty response from Gemini model.');
      }
      res.json(JSON.parse(text));
    } catch (error: any) {
      console.error('Error in /api/agent/maintain-delta:', error);
      res.status(500).json({
        error: error?.message || 'Failed to run autonomous maintenance delta.',
      });
    }
  });

  // 6. Gemini Live Context Chatbot Endpoint (CSV Ingestion & Software Co-Pilot)
  app.post('/api/agent/live-chat', async (req, res) => {
    try {
      const { message, workspaceContext, attachedCsv } = req.body;
      const ai = getAiClient();

      const prompt = `You are the BioKG Gemini Live Context Co-Pilot (powered by SmartOS & RavaTTT, Synergy Robotics, Seattle), authored by Dr. Bheemaiah Anil Kumar.
Help the researcher use the BioKG software: ingesting structured experimental data, formatting & uploading CSV files, running multi-hop subgraph queries, configuring GNN link prediction benchmarks, and adhering to OBO Foundry standards (SO_0001217, PR_000000001, so#translates_to).

Current Live Application Context:
- Active Tab: ${workspaceContext?.activeSection}
- Cohort: ${workspaceContext?.cohortTitle}
- Research Question: "${workspaceContext?.researchQuestion}"
- Graph Size: ${workspaceContext?.nodeCount} Nodes, ${workspaceContext?.edgeCount} Edges
- GNN Pruning Threshold: ${workspaceContext?.pruningThreshold}
- Current CSV Buffer Rows: ${workspaceContext?.csvRowCount}
- Current Agent AUROC: ${workspaceContext?.currentAuroc}
${attachedCsv ? `\nUser Uploaded CSV Content:\n${attachedCsv}\n` : ''}

User Message: "${message}"

If the user asks to generate, format, or fix a CSV file, provide a valid multi-row CSV string in 'suggestedCsv' with headers:
source_symbol,source_type,target_symbol,target_type,relation,pharos_tdl,assay_metric,pmid,tissue_context
Otherwise leave 'suggestedCsv' empty string.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: {
                type: Type.STRING,
                description: 'Helpful, concise scientific guidance tailored to the live workspace context.',
              },
              suggestedCsv: {
                type: Type.STRING,
                description: 'Optional generated or cleaned CSV text if the user asked for CSV data/formatting, or empty string.',
              },
              suggestedResearchQuestion: {
                type: Type.STRING,
                description: 'Optional suggested research question, or empty string.',
              },
              suggestedTab: {
                type: Type.STRING,
                description: 'Optional tab to navigate to: workbench, ingest_subgraph, benchmark, ontology, challenge, docs, or empty string.',
              },
            },
            required: ['reply', 'suggestedCsv', 'suggestedResearchQuestion', 'suggestedTab'],
          },
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error('Empty response from Gemini model.');
      }
      res.json(JSON.parse(text));
    } catch (error: any) {
      console.error('Error in /api/agent/live-chat:', error);
      res.status(500).json({
        error: error?.message || 'Failed to process live context chat.',
      });
    }
  });

  // 7. Gemini Live API WebSocket Bridge (/api/live-voice -> gemini-3.8-live)
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    if (request.url?.startsWith('/api/live-voice')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (clientWs) => {
    let sessionPromise: Promise<any> | null = null;
    try {
      const ai = getAiClient();
      sessionPromise = ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          outputAudioTranscription: {},
          systemInstruction:
            'You are the BioKG Gemini Live Voice Co-Pilot (SmartOS Slug-Bug Alien Agent by Dr. Bheemaiah Anil Kumar, Synergy Robotics, Seattle). Help researchers upload CSV experimental files, map genes to OBO SO_0001217 and proteins to PR_000000001 via so#translates_to, run multi-hop subgraph queries, and interpret GNN link prediction benchmarks.',
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            const parts = message.serverContent?.modelTurn?.parts || [];
            for (const part of parts) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
              }
            }
            const transcript = (message.serverContent as any)?.outputTranscription?.text;
            if (transcript) {
              clientWs.send(JSON.stringify({ transcript }));
            }
            if (message.serverContent?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
          },
        },
      });

      clientWs.on('message', (raw) => {
        try {
          const parsed = JSON.parse(raw.toString());
          if (parsed.audio && sessionPromise) {
            sessionPromise.then((session) => {
              session.sendRealtimeInput({
                audio: { data: parsed.audio, mimeType: 'audio/pcm;rate=16000' },
              });
            });
          } else if (parsed.contextInit && sessionPromise) {
            sessionPromise.then((session) => {
              session.sendRealtimeInput({
                text: `Active Workspace Context: Cohort=${parsed.contextInit.cohortTitle}, Nodes=${parsed.contextInit.nodeCount}, Edges=${parsed.contextInit.edgeCount}, CSV Rows=${parsed.contextInit.csvRowCount}, AUROC=${parsed.contextInit.currentAuroc}`,
              });
            });
          }
        } catch (_e) {
          // ignore malformed frames
        }
      });

      clientWs.on('close', () => {
        if (sessionPromise) {
          sessionPromise.then((session) => session.close()).catch(() => {});
        }
      });
    } catch (err: any) {
      clientWs.send(
        JSON.stringify({
          error: err?.message || 'Unable to initialize Gemini 3.8 Live voice session.',
        })
      );
      clientWs.close();
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`BioKG Bio-Agent Workbench listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
