# PharosKG Bio-Agent Workbench

**Autonomous Knowledge Graph Construction, Ontology Alignment, Subgraph Querying, GNN Confidence Pruning & Link Prediction Studio**  
*Built for the Global Competition: Bio-Agent Knowledge Graph Construction Challenge ("Bridging the Gap: From Static Data to Dynamic Understanding")*

---

## Authorship & Attribution

- **Principal Author & Architect:** Dr. Bheemaiah Anil Kumar  
- **Organization:** Synergy Robotics, Seattle, WA  
- **Competition Track:** Open Source Track ($5,000 USD AWS Credits) / Bio-Agent Knowledge Graph Construction Challenge (Oct 6 – Nov 17, 2026)

---

## 1. Executive Summary

While groundbreaking projects involving biological data are driven by specialized academic labs, a significant disconnect remains between the Knowledge Graph (KG) community and the broader scientific research community. **PharosKG Bio-Agent Workbench** bridges this gap by providing an autonomous 5-stage AI Agent pipeline and interactive scientific workbench that transforms static experimental tables from [NIH Pharos](https://pharos.nih.gov/about) (`Tclin`, `Tchem`, `Tbio`, `Tdark` targets) into a dynamically maintained, ontology-standardized, and GNN-pruned Knowledge Graph optimized for multi-hop subgraph querying and held-out link prediction.

---

## 2. Core Interactive Workbench Modules

### A. Structured Data Ingestion Studio
- **Interactive Triple & Row Builder:** Add experimental relationships directly (`Source Symbol`, `OBO Class`, `Predicate URI`, `Target Symbol`, `Pharos TDL`, `Assay Metric`, `PMID`) or upload `.csv` / `.tsv` experimental tables.
- **Automated OBO Specificity Promotion:** Automatically upgrades generic `http://purl.obolibrary.org/obo/SO_0000704` (`gene`) entries to `http://purl.obolibrary.org/obo/SO_0001217` (`protein_coding_gene`) and constructs canonical `http://purl.obolibrary.org/obo/so#translates_to` edges to `http://purl.obolibrary.org/obo/PR_000000001` (`protein`).

### B. Interactive Multi-Hop Subgraph Query Engine
- **Parameterized k-Hop Traversal:** Select any seed node (and optional target node), hop depth (`1-Hop`, `2-Hop`, `3-Hop`), Pharos Target Development Levels (`Tclin`, `Tchem`, `Tbio`, `Tdark`), and OBO predicate filters (`so#translates_to`, `RO_0002436`, `RO_0003302`, `RO_0002606`, `RO_0002211`).
- **Dual Cypher & BioLink SPARQL Synthesis:** Automatically generates and executes OBO-compliant Cypher and SPARQL queries, isolating relevant multi-hop paths and providing Gemini 3.8 Flash mechanistic interpretation.

### C. GNN Link Prediction Benchmark & Ablation Runner
- **Configurable GNN Architectures:** Compare `Relational GCN (RGCN)`, `GraphSAGE + BioLink Edge Types`, `RotatE Knowledge Embedding`, and `OptimusKG Hybrid GNN+LLM`.
- **Live Feature Ablation Controls:** Toggle `SO_0001217 -> so#translates_to -> PR_000000001` separation, GTEx/CRAPome artifact pruning, and held-out test split ratio (`10%–30%`) to evaluate real-time impacts on **AUROC**, **Hits@10**, and **Mean Reciprocal Rank (MRR)** against the static Pharos baseline.

---

## 3. Adherence to Ontological Standards (OBO Foundry & Monarch BioLink)

To maximize ontological specificity and class parsimony (10% Competition Judging Criterion), all entities and predicates are strictly normalized to canonical OBO Foundry URIs:

| Concept / Relationship | Canonical OBO URI | BioLink Mapping | Specificity Rule |
| :--- | :--- | :--- | :--- |
| **Protein Coding Gene** | `http://purl.obolibrary.org/obo/SO_0001217` | `biolink:Gene` | Preferred specific class over generic `SO_0000704` (`gene`) |
| **Protein** | `http://purl.obolibrary.org/obo/PR_000000001` | `biolink:Protein` | Polypeptide gene product |
| **Translates To** | `http://purl.obolibrary.org/obo/so#translates_to` | `biolink:translates_to` | Directed spine linking `SO_0001217` $\rightarrow$ `PR_000000001` |
| **Molecular Interaction** | `http://purl.obolibrary.org/obo/RO_0002436` | `biolink:molecularly_interacts_with` | Measured via $K_d, K_i, \text{IC}_{50}$, or AP-MS |
| **Substance Treats** | `http://purl.obolibrary.org/obo/RO_0002606` | `biolink:treats` | Clinical or chemical probe therapeutic indication |
| **Contributes to Condition** | `http://purl.obolibrary.org/obo/RO_0003302` | `biolink:contributes_to` | Causal somatic driver or GWAS locus association |
| **Disease / Phenotype** | `http://purl.obolibrary.org/obo/MONDO_0000001` | `biolink:Disease` | Unified Monarch Disease Ontology (`MONDO`) |

---

## 4. Render Blueprint (`render.yaml`) & GitHub Deployment

This repository includes a production-ready **Render Blueprint (`render.yaml`)** for automated Infrastructure-as-Code deployment directly from GitHub.

### `render.yaml` Specification
```yaml
services:
  - type: web
    name: pharoskg-bio-agent-workbench
    runtime: node
    plan: starter
    region: oregon
    branch: main
    buildCommand: npm install && npm run build
    startCommand: npm run start
    healthCheckPath: /api/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 3000
      - key: GEMINI_API_KEY
        sync: false
```

### Deploying from GitHub to Render
1. Push this repository to GitHub (including `/render.yaml`, `/package.json`, `/server.ts`, and `/src`).
2. In the [Render Dashboard](https://dashboard.render.com/blueprints), click **New + $\rightarrow$ Blueprint** and connect your GitHub repository.
3. Render automatically parses `render.yaml`, configures the build (`npm install && npm run build`) and start command (`npm run start`), registers `/api/health`, and prompts securely for `GEMINI_API_KEY`.

---

## 5. Server API Endpoints (`server.ts`)

- `GET /api/health` — Render Blueprint service health and OBO standard readiness check.
- `POST /api/agent/pipeline` — Executes the 5-stage autonomous KG construction, OBO URI promotion, GNN confidence pruning, and held-out link prediction pipeline.
- `POST /api/agent/subgraph-query` — Executes multi-hop subgraph extraction and Gemini 3.8 Flash path synthesis across selected seed nodes, hop depths, and TDL filters.
- `POST /api/agent/run-benchmark` — Runs configurable GNN link prediction benchmarks (`RGCN`, `GraphSAGE`, `RotatE`, `OptimusKG`) and returns comparative AUROC, Hits@10, MRR, and ROC coordinates.
- `POST /api/agent/explain-edge` — Runs a deep multi-hop biological lineage and OBO specificity audit on any selected graph edge.
- `POST /api/agent/maintain-delta` — Processes live literature and Pharos v3.19 delta updates into the active knowledge graph.

---

## 6. Local Development

```bash
# Install dependencies
npm install

# Start full-stack Express + Vite server on port 3000
npm run dev

# Type-check & build for production
npm run lint
npm run build
```

---

*© 2026 Dr. Bheemaiah Anil Kumar, Synergy Robotics, Seattle. All rights reserved.*
