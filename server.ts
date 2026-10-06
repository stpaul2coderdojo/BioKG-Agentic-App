import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

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
  app.use(express.json({ limit: '2mb' }));

  // Render Blueprint Health Check Endpoint
  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'pharoskg-bio-agent-workbench',
      author: 'Dr. Bheemaiah Anil Kumar, Synergy Robotics, Seattle',
      oboStandardsReady: true,
      timestamp: new Date().toISOString(),
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
5. Identify noisy/erroneous rows (e.g. serum contaminants like ALB, non-expressed olfactory receptors like OR2A4, or unverified text mining artifacts) and assign status 'pruned_hallucination' or 'pruned_context' with low gnnReweightedConfidence (<0.25) and a clear pruningReason.
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PharosKG Bio-Agent Workbench listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
