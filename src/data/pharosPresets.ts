export type OntologyClassURI =
  | 'http://purl.obolibrary.org/obo/SO_0001217' // protein_coding_gene
  | 'http://purl.obolibrary.org/obo/SO_0000704' // gene (generic - penalized for protein coding genes)
  | 'http://purl.obolibrary.org/obo/PR_000000001' // protein
  | 'http://purl.obolibrary.org/obo/CHEBI_23888' // drug / chemical substance
  | 'http://purl.obolibrary.org/obo/MONDO_0000001' // disease or disorder
  | 'http://purl.obolibrary.org/obo/GO_0008150'; // biological_process / molecular pathway

export type OntologyPredicateURI =
  | 'http://purl.obolibrary.org/obo/so#translates_to'
  | 'http://purl.obolibrary.org/obo/RO_0002436' // molecularly_interacts_with
  | 'http://purl.obolibrary.org/obo/RO_0002606' // is_substance_that_treats
  | 'http://purl.obolibrary.org/obo/RO_0003302' // causes_or_contributes_to_condition
  | 'http://purl.obolibrary.org/obo/RO_0002211'; // regulates

export type PharosTDL = 'Tclin' | 'Tchem' | 'Tbio' | 'Tdark' | 'N/A';

export interface KGNode {
  id: string;
  label: string;
  symbol: string;
  ontologyClass: OntologyClassURI;
  ontologyLabel: string;
  biolinkCategory: string;
  tdl: PharosTDL;
  sourceDb: string;
  externalCurie: string;
  x: number;
  y: number;
  relevanceScore: number; // 0.0 to 1.0
  isFilteredOut?: boolean;
  upgradedFromGenericGene?: boolean;
  description: string;
}

export interface KGEdge {
  id: string;
  source: string;
  target: string;
  predicateUri: OntologyPredicateURI;
  predicateLabel: string;
  biolinkPredicate: string;
  rawConfidence: number; // Initial ingestion score
  gnnReweightedConfidence: number; // Post-GNN & literature validation score
  evidenceSource: string;
  pmid?: string;
  assayValue?: string;
  status: 'verified' | 'pruned_hallucination' | 'pruned_context' | 'predicted_heldout' | 'delta_maintained';
  lineageExplanation: string;
  pruningReason?: string;
}

export interface PharosPreset {
  id: string;
  title: string;
  subtitle: string;
  defaultResearchQuestion: string;
  cypherQuery: string;
  rawTabularSample: string;
  nodes: KGNode[];
  edges: KGEdge[];
  benchmarkMetrics: {
    pharosBaselineAuroc: number;
    agentEnrichedAuroc: number;
    pharosBaselineHitsAt10: number;
    agentEnrichedHitsAt10: number;
    pharosBaselineMrr: number;
    agentEnrichedMrr: number;
    rocCurve: Array<{ fpr: number; tprBaseline: number; tprAgent: number }>;
  };
}

export const ONTOLOGY_STANDARD_VOCAB = [
  {
    uri: 'http://purl.obolibrary.org/obo/SO_0001217',
    label: 'protein_coding_gene',
    biolink: 'biolink:GenomicEntity / biolink:Gene',
    rule: 'Preferred specific class over generic SO_0000704 (gene) for all protein-encoding loci.',
    status: 'Preferred Specific'
  },
  {
    uri: 'http://purl.obolibrary.org/obo/PR_000000001',
    label: 'protein',
    biolink: 'biolink:Protein',
    rule: 'Polypeptide gene product translated from a protein_coding_gene.',
    status: 'Preferred Specific'
  },
  {
    uri: 'http://purl.obolibrary.org/obo/so#translates_to',
    label: 'translates_to',
    biolink: 'biolink:translates_to',
    rule: 'Canonical directed edge connecting SO_0001217 (protein_coding_gene) -> PR_000000001 (protein).',
    status: 'Canonical Predicate'
  },
  {
    uri: 'http://purl.obolibrary.org/obo/SO_0000704',
    label: 'gene (generic)',
    biolink: 'biolink:Gene',
    rule: 'Penalized when applied to known protein-coding loci; agent automatically promotes to SO_0001217.',
    status: 'Deprecated / Over-General'
  },
  {
    uri: 'http://purl.obolibrary.org/obo/RO_0002436',
    label: 'molecularly_interacts_with',
    biolink: 'biolink:molecularly_interacts_with',
    rule: 'Physical or biochemical binding measured via Kd, Ki, or IC50 in Pharos/ChEMBL.',
    status: 'Canonical Predicate'
  },
  {
    uri: 'http://purl.obolibrary.org/obo/MONDO_0000001',
    label: 'disease or disorder',
    biolink: 'biolink:Disease',
    rule: 'Monarch Disease Ontology unified disease representation.',
    status: 'Preferred Specific'
  }
];

export const PHAROS_PRESETS: PharosPreset[] = [
  {
    id: 'nsclc-dark-kinome',
    title: 'Pharos Cohort 01: Dark Kinome & EGFR-Mutant NSCLC Link Prediction',
    subtitle: 'Integrates NIH Pharos Tdark/Tchem kinase bioactivities with Monarch disease annotations & protein translation lineage',
    defaultResearchQuestion:
      'Which understudied Tchem or Tdark kinases interact with translated EGFR pathway proteins and predict synthetic lethality in Non-Small Cell Lung Carcinoma?',
    cypherQuery: `MATCH (g:SO_0001217)-[:\`http://purl.obolibrary.org/obo/so#translates_to\`]->(p:PR_000000001)
WHERE p.tdl IN ['Tclin', 'Tchem', 'Tdark']
MATCH (p)-[r:\`http://purl.obolibrary.org/obo/RO_0002436\`*1..2]-(d:MONDO_0000001 {curie: 'MONDO:0005233'})
WHERE r.gnn_confidence >= $pruningThreshold
RETURN g, p, r, d LIMIT $maxNodes`,
    rawTabularSample: `source_symbol,source_type,target_symbol,target_type,relation,pharos_tdl,assay_metric,pmid,tissue_context
EGFR,gene,ErbB-1,protein,translates_to,Tclin,RefSeq:NM_005228,PMID:36443601,Lung Epithelium
ULK1,gene,ULK1_Protein,protein,translates_to,Tchem,RefSeq:NM_003565,PMID:34887112,Lung Epithelium
VRK2,gene,VRK2_Kinase,protein,translates_to,Tdark,RefSeq:NM_006296,PMID:37102944,Bronchial Alveolar
Osimertinib,drug,ErbB-1,protein,molecularly_interacts_with,Tclin,IC50=1.2nM,PMID:29151359,Lung Adenocarcinoma
ErbB-1,protein,NSCLC,disease,causes_or_contributes_to_condition,Tclin,GWAS_p=2.4e-19,PMID:31427789,Lung Epithelium
ULK1_Protein,protein,ErbB-1,protein,regulates,Tchem,Kd=18.5nM,PMID:35902114,Autophagy Bypass
VRK2_Kinase,protein,ErbB-1,protein,molecularly_interacts_with,Tdark,CoIP_score=0.89,PMID:38019283,Lung Adenocarcinoma
ALB,gene,NSCLC,disease,causes_or_contributes_to_condition,Tbio,Spurious_Artifact,PMID:None,Serum_Contaminant
olfactory_OR2A4,gene,ErbB-1,protein,molecularly_interacts_with,Tdark,Y2H_Noise=0.14,PMID:None,Olfactory_Bulb`,
    nodes: [
      {
        id: 'node-egfr-gene',
        label: 'EGFR (Protein Coding Gene)',
        symbol: 'EGFR',
        ontologyClass: 'http://purl.obolibrary.org/obo/SO_0001217',
        ontologyLabel: 'SO_0001217 (protein_coding_gene)',
        biolinkCategory: 'biolink:Gene',
        tdl: 'Tclin',
        sourceDb: 'Pharos / HGNC:3236',
        externalCurie: 'ENSEMBL:ENSG00000146648',
        x: 140,
        y: 130,
        relevanceScore: 0.99,
        upgradedFromGenericGene: true,
        description: 'Epidermal growth factor receptor locus on chr7p11.2. Promoted from generic SO_0000704 to SO_0001217.'
      },
      {
        id: 'node-egfr-prot',
        label: 'Receptor Tyrosine-Protein Kinase erbB-1',
        symbol: 'EGFR_PROT',
        ontologyClass: 'http://purl.obolibrary.org/obo/PR_000000001',
        ontologyLabel: 'PR_000000001 (protein)',
        biolinkCategory: 'biolink:Protein',
        tdl: 'Tclin',
        sourceDb: 'Pharos / UniProt:P00533',
        externalCurie: 'PR:P00533',
        x: 370,
        y: 165,
        relevanceScore: 0.98,
        description: 'Translated transmembrane receptor tyrosine kinase driving cell proliferation and TKI resistance.'
      },
      {
        id: 'node-ulk1-gene',
        label: 'ULK1 (Protein Coding Gene)',
        symbol: 'ULK1',
        ontologyClass: 'http://purl.obolibrary.org/obo/SO_0001217',
        ontologyLabel: 'SO_0001217 (protein_coding_gene)',
        biolinkCategory: 'biolink:Gene',
        tdl: 'Tchem',
        sourceDb: 'Pharos / HGNC:12558',
        externalCurie: 'ENSEMBL:ENSG00000177169',
        x: 135,
        y: 300,
        relevanceScore: 0.94,
        upgradedFromGenericGene: true,
        description: 'Unc-51 like autophagy activating kinase 1 gene. Promoted from SO_0000704 to SO_0001217.'
      },
      {
        id: 'node-ulk1-prot',
        label: 'Serine/Threonine-Protein Kinase ULK1',
        symbol: 'ULK1_PROT',
        ontologyClass: 'http://purl.obolibrary.org/obo/PR_000000001',
        ontologyLabel: 'PR_000000001 (protein)',
        biolinkCategory: 'biolink:Protein',
        tdl: 'Tchem',
        sourceDb: 'Pharos / UniProt:O75385',
        externalCurie: 'PR:O75385',
        x: 375,
        y: 310,
        relevanceScore: 0.95,
        description: 'Tchem kinase regulating cytoprotective autophagy in TKI-resistant lung adenocarcinoma.'
      },
      {
        id: 'node-vrk2-gene',
        label: 'VRK2 (Protein Coding Gene)',
        symbol: 'VRK2',
        ontologyClass: 'http://purl.obolibrary.org/obo/SO_0001217',
        ontologyLabel: 'SO_0001217 (protein_coding_gene)',
        biolinkCategory: 'biolink:Gene',
        tdl: 'Tdark',
        sourceDb: 'Pharos IDG / HGNC:12719',
        externalCurie: 'ENSEMBL:ENSG00000028116',
        x: 160,
        y: 465,
        relevanceScore: 0.91,
        upgradedFromGenericGene: true,
        description: 'Understudied Tdark Vaccinia-related kinase 2 locus enriched in chr2p16.1.'
      },
      {
        id: 'node-vrk2-prot',
        label: 'Serine/Threonine-Protein Kinase VRK2',
        symbol: 'VRK2_PROT',
        ontologyClass: 'http://purl.obolibrary.org/obo/PR_000000001',
        ontologyLabel: 'PR_000000001 (protein)',
        biolinkCategory: 'biolink:Protein',
        tdl: 'Tdark',
        sourceDb: 'Pharos IDG / UniProt:Q86Y07',
        externalCurie: 'PR:Q86Y07',
        x: 395,
        y: 455,
        relevanceScore: 0.92,
        description: 'Understudied Tdark nuclear envelope protein kinase regulating MAPK scaffold complexes.'
      },
      {
        id: 'node-osimertinib',
        label: 'Osimertinib (AZD9291)',
        symbol: 'OSIMERTINIB',
        ontologyClass: 'http://purl.obolibrary.org/obo/CHEBI_23888',
        ontologyLabel: 'CHEBI_23888 (drug)',
        biolinkCategory: 'biolink:Drug',
        tdl: 'Tclin',
        sourceDb: 'ChEMBL:CHEMBL3353410',
        externalCurie: 'CHEBI:90943',
        x: 615,
        y: 95,
        relevanceScore: 0.96,
        description: 'Third-generation covalent EGFR T790M/L858R tyrosine kinase inhibitor.'
      },
      {
        id: 'node-sbi0206965',
        label: 'SBI-0206965 (Chemical Probe)',
        symbol: 'SBI-0206965',
        ontologyClass: 'http://purl.obolibrary.org/obo/CHEBI_23888',
        ontologyLabel: 'CHEBI_23888 (drug)',
        biolinkCategory: 'biolink:ChemicalEntity',
        tdl: 'Tchem',
        sourceDb: 'Pharos / ChEMBL:CHEMBL3589621',
        externalCurie: 'CHEBI:145812',
        x: 625,
        y: 385,
        relevanceScore: 0.89,
        description: 'Selective small-molecule ULK1/FAK kinase probe extracted from Pharos Tchem bioactivity table.'
      },
      {
        id: 'node-nsclc',
        label: 'Non-Small Cell Lung Carcinoma',
        symbol: 'NSCLC',
        ontologyClass: 'http://purl.obolibrary.org/obo/MONDO_0000001',
        ontologyLabel: 'MONDO_0005233 (disease)',
        biolinkCategory: 'biolink:Disease',
        tdl: 'N/A',
        sourceDb: 'Monarch / MONDO:0005233',
        externalCurie: 'MONDO:0005233',
        x: 805,
        y: 235,
        relevanceScore: 0.99,
        description: 'Epithelial lung carcinoma subtype characterized by driver receptor tyrosine kinase mutations.'
      },
      {
        id: 'node-autophagy-go',
        label: 'Macroautophagy Signaling Pathway',
        symbol: 'GO:0016236',
        ontologyClass: 'http://purl.obolibrary.org/obo/GO_0008150',
        ontologyLabel: 'GO_0016236 (biological_process)',
        biolinkCategory: 'biolink:BiologicalProcess',
        tdl: 'N/A',
        sourceDb: 'Gene Ontology / Monarch',
        externalCurie: 'GO:0016236',
        x: 620,
        y: 250,
        relevanceScore: 0.90,
        description: 'Lysosomal degradation pathway activated as an adaptive survival mechanism during EGFR inhibition.'
      },
      {
        id: 'node-alb-noise',
        label: 'ALB (Serum Albumin Artifact)',
        symbol: 'ALB',
        ontologyClass: 'http://purl.obolibrary.org/obo/SO_0000704',
        ontologyLabel: 'SO_0000704 (generic gene)',
        biolinkCategory: 'biolink:Gene',
        tdl: 'Tbio',
        sourceDb: 'Raw MassSpec Table Row #184',
        externalCurie: 'HGNC:399',
        x: 785,
        y: 465,
        relevanceScore: 0.18,
        isFilteredOut: true,
        description: 'High-abundance serum carrier protein frequently co-precipitating as non-specific background noise.'
      },
      {
        id: 'node-or2a4-noise',
        label: 'OR2A4 (Olfactory Receptor 2A4)',
        symbol: 'OR2A4',
        ontologyClass: 'http://purl.obolibrary.org/obo/SO_0001217',
        ontologyLabel: 'SO_0001217 (protein_coding_gene)',
        biolinkCategory: 'biolink:Gene',
        tdl: 'Tdark',
        sourceDb: 'Pharos High-Throughput Y2H',
        externalCurie: 'HGNC:15021',
        x: 410,
        y: 55,
        relevanceScore: 0.12,
        isFilteredOut: true,
        description: 'Olfactory sensory neuron GPCR not expressed in human alveolar or bronchial epithelium (TPM < 0.01).'
      }
    ],
    edges: [
      {
        id: 'edge-egfr-trans',
        source: 'node-egfr-gene',
        target: 'node-egfr-prot',
        predicateUri: 'http://purl.obolibrary.org/obo/so#translates_to',
        predicateLabel: 'so#translates_to',
        biolinkPredicate: 'biolink:translates_to',
        rawConfidence: 0.99,
        gnnReweightedConfidence: 0.99,
        evidenceSource: 'Sequence Ontology / Ensembl Canonical NM_005228.5',
        pmid: 'PMID:36443601',
        assayValue: 'Canonical Transcript MANE Select',
        status: 'verified',
        lineageExplanation:
          'Direct Sequence Ontology translation mapping: EGFR (http://purl.obolibrary.org/obo/SO_0001217) translates_to (http://purl.obolibrary.org/obo/so#translates_to) Receptor Tyrosine-Protein Kinase erbB-1 (http://purl.obolibrary.org/obo/PR_000000001).'
      },
      {
        id: 'edge-ulk1-trans',
        source: 'node-ulk1-gene',
        target: 'node-ulk1-prot',
        predicateUri: 'http://purl.obolibrary.org/obo/so#translates_to',
        predicateLabel: 'so#translates_to',
        biolinkPredicate: 'biolink:translates_to',
        rawConfidence: 0.99,
        gnnReweightedConfidence: 0.99,
        evidenceSource: 'Sequence Ontology / RefSeq NM_003565.4',
        pmid: 'PMID:34887112',
        assayValue: 'Canonical Transcript MANE Select',
        status: 'verified',
        lineageExplanation:
          'Direct Sequence Ontology translation mapping: ULK1 (http://purl.obolibrary.org/obo/SO_0001217) translates_to (http://purl.obolibrary.org/obo/so#translates_to) ULK1 Kinase (http://purl.obolibrary.org/obo/PR_000000001).'
      },
      {
        id: 'edge-vrk2-trans',
        source: 'node-vrk2-gene',
        target: 'node-vrk2-prot',
        predicateUri: 'http://purl.obolibrary.org/obo/so#translates_to',
        predicateLabel: 'so#translates_to',
        biolinkPredicate: 'biolink:translates_to',
        rawConfidence: 0.98,
        gnnReweightedConfidence: 0.99,
        evidenceSource: 'Sequence Ontology / Pharos IDG Target Table',
        pmid: 'PMID:37102944',
        assayValue: 'UniProt Q86Y07 Canonical',
        status: 'verified',
        lineageExplanation:
          'Direct Sequence Ontology translation mapping: VRK2 (http://purl.obolibrary.org/obo/SO_0001217) translates_to (http://purl.obolibrary.org/obo/so#translates_to) VRK2 Kinase (http://purl.obolibrary.org/obo/PR_000000001).'
      },
      {
        id: 'edge-osi-egfr',
        source: 'node-osimertinib',
        target: 'node-egfr-prot',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0002436',
        predicateLabel: 'RO_0002436 (interacts_with)',
        biolinkPredicate: 'biolink:molecularly_interacts_with',
        rawConfidence: 0.97,
        gnnReweightedConfidence: 0.98,
        evidenceSource: 'Pharos / ChEMBL Bioactivity Assay #1490822',
        pmid: 'PMID:29151359',
        assayValue: 'IC50 = 1.2 nM (Covalent Cys797)',
        status: 'verified',
        lineageExplanation:
          'Osimertinib irreversibly binds EGFR_PROT (PR_000000001) at residue Cys797 with measured IC50 = 1.2 nM in Pharos Tclin bioactivity tables.'
      },
      {
        id: 'edge-osi-nsclc',
        source: 'node-osimertinib',
        target: 'node-nsclc',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0002606',
        predicateLabel: 'RO_0002606 (treats)',
        biolinkPredicate: 'biolink:treats',
        rawConfidence: 0.96,
        gnnReweightedConfidence: 0.97,
        evidenceSource: 'Monarch Initiative / FDA FLAURA Trial',
        pmid: 'PMID:29151359',
        assayValue: 'Phase III HR = 0.46',
        status: 'verified',
        lineageExplanation:
          'Validated clinical indication linking CHEBI:90943 (Osimertinib) to MONDO:0005233 (NSCLC) via first-line progression-free survival benefit.'
      },
      {
        id: 'edge-egfr-nsclc',
        source: 'node-egfr-prot',
        target: 'node-nsclc',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0003302',
        predicateLabel: 'RO_0003302 (contributes_to)',
        biolinkPredicate: 'biolink:contributes_to',
        rawConfidence: 0.95,
        gnnReweightedConfidence: 0.98,
        evidenceSource: 'Monarch KG / OMIM & COSMIC Driver Census',
        pmid: 'PMID:31427789',
        assayValue: 'GWAS p = 2.4e-19',
        status: 'verified',
        lineageExplanation:
          'Somatic activating mutations in EGFR_PROT (L858R, Exon19del) directly drive oncogenic signaling in MONDO:0005233.'
      },
      {
        id: 'edge-ulk1-autophagy',
        source: 'node-ulk1-prot',
        target: 'node-autophagy-go',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0002211',
        predicateLabel: 'RO_0002211 (regulates)',
        biolinkPredicate: 'biolink:regulates',
        rawConfidence: 0.91,
        gnnReweightedConfidence: 0.94,
        evidenceSource: 'Gene Ontology Experimental Annotation (IDA)',
        pmid: 'PMID:35902114',
        assayValue: 'Phospho-ATG13 Ser318 Assay',
        status: 'verified',
        lineageExplanation:
          'ULK1_PROT phosphorylates ATG13 and FIP200 to initiate GO:0016236 (macroautophagy) under EGFR tyrosine kinase blockade.'
      },
      {
        id: 'edge-autophagy-nsclc',
        source: 'node-autophagy-go',
        target: 'node-nsclc',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0003302',
        predicateLabel: 'RO_0003302 (contributes_to)',
        biolinkPredicate: 'biolink:contributes_to',
        rawConfidence: 0.86,
        gnnReweightedConfidence: 0.91,
        evidenceSource: 'Monarch Pathway-Disease Association',
        pmid: 'PMID:35902114',
        assayValue: 'CRISPR Drop-out FDR = 0.004',
        status: 'verified',
        lineageExplanation:
          'Cytoprotective macroautophagy enables persister cell survival in EGFR-mutant NSCLC treated with Osimertinib.'
      },
      {
        id: 'edge-sbi-ulk1',
        source: 'node-sbi0206965',
        target: 'node-ulk1-prot',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0002436',
        predicateLabel: 'RO_0002436 (interacts_with)',
        biolinkPredicate: 'biolink:molecularly_interacts_with',
        rawConfidence: 0.89,
        gnnReweightedConfidence: 0.93,
        evidenceSource: 'Pharos Tchem Bioactivity Table',
        pmid: 'PMID:26092793',
        assayValue: 'IC50 = 108 nM (Kinase Assay)',
        status: 'verified',
        lineageExplanation:
          'Pharos Tchem chemical probe SBI-0206965 inhibits ULK1_PROT catalytic domain with IC50 = 108 nM.'
      },
      {
        id: 'edge-vrk2-egfr',
        source: 'node-vrk2-prot',
        target: 'node-egfr-prot',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0002436',
        predicateLabel: 'RO_0002436 (interacts_with)',
        biolinkPredicate: 'biolink:molecularly_interacts_with',
        rawConfidence: 0.82,
        gnnReweightedConfidence: 0.89,
        evidenceSource: 'Pharos IDG Dark Kinome Interactome (BioPlex 3.0)',
        pmid: 'PMID:38019283',
        assayValue: 'AP-MS Score = 0.89',
        status: 'verified',
        lineageExplanation:
          'Affinity purification mass spectrometry in lung epithelial cells links Tdark kinase VRK2_PROT to the ErbB-1/KSR1 signaling complex.'
      },
      {
        id: 'edge-predicted-ulk1-nsclc',
        source: 'node-ulk1-prot',
        target: 'node-nsclc',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0003302',
        predicateLabel: 'RO_0003302 (predicted link)',
        biolinkPredicate: 'biolink:contributes_to',
        rawConfidence: 0.0,
        gnnReweightedConfidence: 0.94,
        evidenceSource: 'GNN Held-Out Link Prediction (3-Hop Enriched Path)',
        pmid: 'PMID:35902114',
        assayValue: 'GNN Link Score = 0.942',
        status: 'predicted_heldout',
        lineageExplanation:
          'HELD-OUT LINK PREDICTED BY AGENT GNN: Inferred via 2-hop path [ULK1_PROT -> regulates -> GO:0016236 -> contributes_to -> NSCLC] and co-regulation with EGFR_PROT. Absent in baseline static Pharos disease table.'
      },
      {
        id: 'edge-predicted-vrk2-nsclc',
        source: 'node-vrk2-prot',
        target: 'node-nsclc',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0003302',
        predicateLabel: 'RO_0003302 (predicted link)',
        biolinkPredicate: 'biolink:contributes_to',
        rawConfidence: 0.0,
        gnnReweightedConfidence: 0.88,
        evidenceSource: 'GNN Held-Out Link Prediction (Dark Kinome Bridge)',
        pmid: 'PMID:38019283',
        assayValue: 'GNN Link Score = 0.884',
        status: 'predicted_heldout',
        lineageExplanation:
          'HELD-OUT LINK PREDICTED BY AGENT GNN: Tdark kinase VRK2_PROT predicted as synthetic lethal modifier in MONDO:0005233 via shared BioPlex interaction neighborhood with EGFR_PROT.'
      },
      {
        id: 'edge-predicted-sbi-nsclc',
        source: 'node-sbi0206965',
        target: 'node-nsclc',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0002606',
        predicateLabel: 'RO_0002606 (predicted treats)',
        biolinkPredicate: 'biolink:treats',
        rawConfidence: 0.0,
        gnnReweightedConfidence: 0.86,
        evidenceSource: 'GNN Held-Out Link Prediction (Drug Repurposing)',
        pmid: 'PMID:26092793',
        assayValue: 'GNN Link Score = 0.861',
        status: 'predicted_heldout',
        lineageExplanation:
          'HELD-OUT LINK PREDICTED BY AGENT GNN: Chemical probe SBI-0206965 -> inhibits ULK1_PROT -> blocks GO:0016236 survival bypass in Osimertinib-resistant MONDO:0005233.'
      },
      {
        id: 'edge-pruned-alb',
        source: 'node-alb-noise',
        target: 'node-nsclc',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0003302',
        predicateLabel: 'RO_0003302 (erroneous)',
        biolinkPredicate: 'biolink:contributes_to',
        rawConfidence: 0.74,
        gnnReweightedConfidence: 0.11,
        evidenceSource: 'Unfiltered Text-Mining / MassSpec Contaminant',
        pmid: 'None (Hallucinated)',
        assayValue: 'CRAPome Freq = 94%',
        status: 'pruned_hallucination',
        pruningReason:
          'Pruned by Clean Agent: ALB uses generic SO_0000704 and appears in 94% of negative-control AP-MS runs (CRAPome contaminant); GNN downweighted confidence from 0.74 to 0.11.',
        lineageExplanation:
          'Erroneous co-occurrence link extracted from noisy text table. Rejected due to lack of causal somatic evidence in Monarch/COSMIC.'
      },
      {
        id: 'edge-pruned-or2a4',
        source: 'node-or2a4-noise',
        target: 'node-egfr-prot',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0002436',
        predicateLabel: 'RO_0002436 (context mismatch)',
        biolinkPredicate: 'biolink:molecularly_interacts_with',
        rawConfidence: 0.68,
        gnnReweightedConfidence: 0.14,
        evidenceSource: 'Yeast Two-Hybrid (Y2H) Raw Screen',
        pmid: 'None',
        assayValue: 'GTEx Lung TPM = 0.00',
        status: 'pruned_context',
        pruningReason:
          'Pruned by Clean Agent: Contextually invalid link for NSCLC query. GTEx v8 confirms OR2A4 has 0.00 TPM expression in lung epithelium; Y2H interaction is non-physiological.',
        lineageExplanation:
          'Y2H artifact between ectopically expressed membrane proteins; tissue expression filter removed edge.'
      }
    ],
    benchmarkMetrics: {
      pharosBaselineAuroc: 0.742,
      agentEnrichedAuroc: 0.918,
      pharosBaselineHitsAt10: 0.410,
      agentEnrichedHitsAt10: 0.785,
      pharosBaselineMrr: 0.364,
      agentEnrichedMrr: 0.692,
      rocCurve: [
        { fpr: 0.0, tprBaseline: 0.0, tprAgent: 0.0 },
        { fpr: 0.05, tprBaseline: 0.24, tprAgent: 0.58 },
        { fpr: 0.10, tprBaseline: 0.38, tprAgent: 0.74 },
        { fpr: 0.20, tprBaseline: 0.52, tprAgent: 0.85 },
        { fpr: 0.35, tprBaseline: 0.66, tprAgent: 0.92 },
        { fpr: 0.50, tprBaseline: 0.75, tprAgent: 0.96 },
        { fpr: 0.75, tprBaseline: 0.88, tprAgent: 0.985 },
        { fpr: 1.0, tprBaseline: 1.0, tprAgent: 1.0 }
      ]
    }
  },
  {
    id: 'neuro-lysosomal-tdark',
    title: 'Pharos Cohort 02: Lysosomal Tdark Ion Channels in Parkinsonian Syndromes',
    subtitle: 'Enriches Pharos Tdark/Tbio transmembrane proteins with Monarch phenotypic ontology & ChEMBL probes',
    defaultResearchQuestion:
      'Which understudied lysosomal proteins interact with LRRK2 and GBA1 to modulate glucosylceramide clearance in Parkinson disease?',
    cypherQuery: `MATCH (g:SO_0001217)-[:\`http://purl.obolibrary.org/obo/so#translates_to\`]->(p:PR_000000001)
WHERE p.symbol IN ['LRRK2_PROT', 'TMEM175_PROT', 'GBA1_PROT']
MATCH (p)-[r*1..2]-(d:MONDO_0000001 {curie: 'MONDO:0005180'})
WHERE r.gnn_confidence >= $pruningThreshold
RETURN g, p, r, d`,
    rawTabularSample: `source_symbol,source_type,target_symbol,target_type,relation,pharos_tdl,assay_metric,pmid,tissue_context
LRRK2,gene,LRRK2_PROT,protein,translates_to,Tchem,RefSeq:NM_198578,PMID:33109241,Substantia Nigra
TMEM175,gene,TMEM175_PROT,protein,translates_to,Tbio,RefSeq:NM_032326,PMID:32483329,Lysosomal Membrane
GBA1,gene,GBA1_PROT,protein,translates_to,Tclin,RefSeq:NM_000157,PMID:31992381,Lysosomal Lumen
Ambroxol,drug,GBA1_PROT,protein,molecularly_interacts_with,Tclin,EC50=4.2uM,PMID:32049015,Dopaminergic Neuron
LRRK2_PROT,protein,Parkinson_Disease,disease,causes_or_contributes_to_condition,Tchem,GWAS_p=1.1e-42,PMID:31701892,Substantia Nigra`,
    nodes: [
      {
        id: 'node-lrrk2-gene',
        label: 'LRRK2 (Protein Coding Gene)',
        symbol: 'LRRK2',
        ontologyClass: 'http://purl.obolibrary.org/obo/SO_0001217',
        ontologyLabel: 'SO_0001217 (protein_coding_gene)',
        biolinkCategory: 'biolink:Gene',
        tdl: 'Tchem',
        sourceDb: 'Pharos / HGNC:18618',
        externalCurie: 'ENSEMBL:ENSG00000188906',
        x: 150,
        y: 150,
        relevanceScore: 0.98,
        upgradedFromGenericGene: true,
        description: 'Leucine-rich repeat kinase 2 locus on chr12q12. Promoted to specific SO_0001217.'
      },
      {
        id: 'node-lrrk2-prot',
        label: 'Leucine-Rich Repeat Serine/Threonine-Protein Kinase 2',
        symbol: 'LRRK2_PROT',
        ontologyClass: 'http://purl.obolibrary.org/obo/PR_000000001',
        ontologyLabel: 'PR_000000001 (protein)',
        biolinkCategory: 'biolink:Protein',
        tdl: 'Tchem',
        sourceDb: 'Pharos / UniProt:Q5S007',
        externalCurie: 'PR:Q5S007',
        x: 380,
        y: 170,
        relevanceScore: 0.99,
        description: 'Multi-domain ROCO kinase regulating Rab GTPase phosphorylation and endolysosomal trafficking.'
      },
      {
        id: 'node-tmem175-gene',
        label: 'TMEM175 (Protein Coding Gene)',
        symbol: 'TMEM175',
        ontologyClass: 'http://purl.obolibrary.org/obo/SO_0001217',
        ontologyLabel: 'SO_0001217 (protein_coding_gene)',
        biolinkCategory: 'biolink:Gene',
        tdl: 'Tbio',
        sourceDb: 'Pharos IDG / HGNC:28706',
        externalCurie: 'ENSEMBL:ENSG00000127419',
        x: 150,
        y: 350,
        relevanceScore: 0.95,
        upgradedFromGenericGene: true,
        description: 'Transmembrane protein 175 gene encoding a proton-activated lysosomal potassium/proton channel.'
      },
      {
        id: 'node-tmem175-prot',
        label: 'Endolysosomal Potassium Channel TMEM175',
        symbol: 'TMEM175_PROT',
        ontologyClass: 'http://purl.obolibrary.org/obo/PR_000000001',
        ontologyLabel: 'PR_000000001 (protein)',
        biolinkCategory: 'biolink:Protein',
        tdl: 'Tbio',
        sourceDb: 'Pharos / UniProt:Q9BSA9',
        externalCurie: 'PR:Q9BSA9',
        x: 390,
        y: 350,
        relevanceScore: 0.96,
        description: 'Lysosomal pH homeostasis channel critical for glucocerebrosidase catalytic activity.'
      },
      {
        id: 'node-ambroxol',
        label: 'Ambroxol (Pharmacological Chaperone)',
        symbol: 'AMBROXOL',
        ontologyClass: 'http://purl.obolibrary.org/obo/CHEBI_23888',
        ontologyLabel: 'CHEBI_23888 (drug)',
        biolinkCategory: 'biolink:Drug',
        tdl: 'Tclin',
        sourceDb: 'ChEMBL:CHEMBL149449',
        externalCurie: 'CHEBI:31209',
        x: 610,
        y: 120,
        relevanceScore: 0.91,
        description: 'Small-molecule chaperone facilitating lysosomal translocation of glucocerebrosidase.'
      },
      {
        id: 'node-pd',
        label: 'Parkinson Disease (MONDO:0005180)',
        symbol: 'PARKINSON',
        ontologyClass: 'http://purl.obolibrary.org/obo/MONDO_0000001',
        ontologyLabel: 'MONDO_0005180 (disease)',
        biolinkCategory: 'biolink:Disease',
        tdl: 'N/A',
        sourceDb: 'Monarch / MONDO:0005180',
        externalCurie: 'MONDO:0005180',
        x: 790,
        y: 260,
        relevanceScore: 0.99,
        description: 'Progressive synucleinopathy affecting substantia nigra pars compacta dopaminergic neurons.'
      }
    ],
    edges: [
      {
        id: 'edge-lrrk2-trans',
        source: 'node-lrrk2-gene',
        target: 'node-lrrk2-prot',
        predicateUri: 'http://purl.obolibrary.org/obo/so#translates_to',
        predicateLabel: 'so#translates_to',
        biolinkPredicate: 'biolink:translates_to',
        rawConfidence: 0.99,
        gnnReweightedConfidence: 0.99,
        evidenceSource: 'Sequence Ontology / Ensembl',
        pmid: 'PMID:33109241',
        assayValue: 'MANE Select NM_198578',
        status: 'verified',
        lineageExplanation: 'LRRK2 (SO_0001217) translates_to LRRK2_PROT (PR_000000001).'
      },
      {
        id: 'edge-tmem175-trans',
        source: 'node-tmem175-gene',
        target: 'node-tmem175-prot',
        predicateUri: 'http://purl.obolibrary.org/obo/so#translates_to',
        predicateLabel: 'so#translates_to',
        biolinkPredicate: 'biolink:translates_to',
        rawConfidence: 0.99,
        gnnReweightedConfidence: 0.99,
        evidenceSource: 'Sequence Ontology / Ensembl',
        pmid: 'PMID:32483329',
        assayValue: 'MANE Select NM_032326',
        status: 'verified',
        lineageExplanation: 'TMEM175 (SO_0001217) translates_to TMEM175_PROT (PR_000000001).'
      },
      {
        id: 'edge-lrrk2-pd',
        source: 'node-lrrk2-prot',
        target: 'node-pd',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0003302',
        predicateLabel: 'RO_0003302 (contributes_to)',
        biolinkPredicate: 'biolink:contributes_to',
        rawConfidence: 0.97,
        gnnReweightedConfidence: 0.98,
        evidenceSource: 'Monarch / ClinVar G2019S Pathogenic Variant',
        pmid: 'PMID:31701892',
        assayValue: 'OR = 4.82 (p=1.1e-42)',
        status: 'verified',
        lineageExplanation: 'Gain-of-kinase-activity mutation G2019S in LRRK2_PROT causes autosomal dominant Parkinson disease.'
      },
      {
        id: 'edge-lrrk2-tmem175',
        source: 'node-lrrk2-prot',
        target: 'node-tmem175-prot',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0002211',
        predicateLabel: 'RO_0002211 (regulates)',
        biolinkPredicate: 'biolink:regulates',
        rawConfidence: 0.84,
        gnnReweightedConfidence: 0.92,
        evidenceSource: 'Pharos / Rab10 Lysosomal Interactome',
        pmid: 'PMID:32483329',
        assayValue: 'Patch-Clamp Conductance',
        status: 'verified',
        lineageExplanation: 'LRRK2_PROT hyperphosphorylation of Rab substrates disrupts TMEM175_PROT lysosomal proton current.'
      },
      {
        id: 'edge-pred-tmem175-pd',
        source: 'node-tmem175-prot',
        target: 'node-pd',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0003302',
        predicateLabel: 'RO_0003302 (predicted link)',
        biolinkPredicate: 'biolink:contributes_to',
        rawConfidence: 0.0,
        gnnReweightedConfidence: 0.93,
        evidenceSource: 'GNN Held-Out Link Prediction',
        pmid: 'PMID:32483329',
        assayValue: 'GNN Link Score = 0.931',
        status: 'predicted_heldout',
        lineageExplanation: 'HELD-OUT LINK PREDICTED BY AGENT GNN: TMEM175_PROT loss-of-function impairs lysosomal acidification and alpha-synuclein clearance in MONDO:0005180.'
      },
      {
        id: 'edge-ambroxol-pd',
        source: 'node-ambroxol',
        target: 'node-pd',
        predicateUri: 'http://purl.obolibrary.org/obo/RO_0002606',
        predicateLabel: 'RO_0002606 (predicted treats)',
        biolinkPredicate: 'biolink:treats',
        rawConfidence: 0.0,
        gnnReweightedConfidence: 0.87,
        evidenceSource: 'GNN Held-Out Link Prediction (AiM-PD Trial)',
        pmid: 'PMID:32049015',
        assayValue: 'GNN Link Score = 0.874',
        status: 'predicted_heldout',
        lineageExplanation: 'HELD-OUT LINK PREDICTED BY AGENT GNN: Ambroxol restores lysosomal enzyme activity downstream of TMEM175/LRRK2 axis.'
      }
    ],
    benchmarkMetrics: {
      pharosBaselineAuroc: 0.718,
      agentEnrichedAuroc: 0.904,
      pharosBaselineHitsAt10: 0.385,
      agentEnrichedHitsAt10: 0.760,
      pharosBaselineMrr: 0.340,
      agentEnrichedMrr: 0.675,
      rocCurve: [
        { fpr: 0.0, tprBaseline: 0.0, tprAgent: 0.0 },
        { fpr: 0.05, tprBaseline: 0.21, tprAgent: 0.55 },
        { fpr: 0.10, tprBaseline: 0.35, tprAgent: 0.71 },
        { fpr: 0.20, tprBaseline: 0.49, tprAgent: 0.83 },
        { fpr: 0.35, tprBaseline: 0.63, tprAgent: 0.90 },
        { fpr: 0.50, tprBaseline: 0.73, tprAgent: 0.95 },
        { fpr: 0.75, tprBaseline: 0.86, tprAgent: 0.98 },
        { fpr: 1.0, tprBaseline: 1.0, tprAgent: 1.0 }
      ]
    }
  }
];

export const CHALLENGE_TIMELINE = [
  {
    date: 'Sep 1 – Sep 18, 2026',
    phase: '01. Application Period',
    detail: 'Global builder & academic team applications submitted.',
    state: 'COMPLETED' as const
  },
  {
    date: 'Sep 25, 2026',
    phase: '02. Accepted Teams Notified',
    detail: 'Cohort selection finalized across Open Source and Closed Source tracks.',
    state: 'COMPLETED' as const
  },
  {
    date: 'Oct 6, 2026 · 11:00 AM ET',
    phase: '03. Official Challenge Kickoff',
    detail: 'LIVE TODAY: All accepted teams join kickoff session; Pharos benchmark datasets released for 6-week sprint.',
    state: 'ACTIVE' as const
  },
  {
    date: 'Oct 27, 2026',
    phase: '04. Intermediate Submission',
    detail: 'Mid-sprint progress report via email & open mentor review hours.',
    state: 'UPCOMING' as const
  },
  {
    date: 'Nov 17, 2026',
    phase: '05. Challenge Submission Close',
    detail: 'Final autonomous KG agent pipelines & GNN link prediction benchmarks locked.',
    state: 'UPCOMING' as const
  },
  {
    date: 'Nov 17 – Dec 8, 2026',
    phase: '06. Evaluation & Judging',
    detail: 'Held-out Pharos link prediction evaluation & 4-metric rubric audit.',
    state: 'UPCOMING' as const
  },
  {
    date: 'Dec 15, 2026',
    phase: '07. Final Results Announced',
    detail: 'Open Source ($5,000 USD AWS Credits) & Closed Source winners recognized.',
    state: 'UPCOMING' as const
  }
];

export const COMPETITION_RESOURCES = [
  {
    category: 'Primary Data & Standards',
    items: [
      {
        title: 'NIH Pharos: Illuminating the Druggable Genome',
        url: 'https://pharos.nih.gov/about',
        summary: 'Primary structured experimental dataset source covering Tclin, Tchem, Tbio, and Tdark targets, ligands, and disease associations.'
      },
      {
        title: 'Monarch Initiative KG Hub & Registry',
        url: 'https://kghub.org/kg-registry/',
        summary: 'Open standards ecosystem providing BioLink Model, LinkML, KGX, SSSOM ontology mappings, and Koza ingestion transforms.'
      }
    ]
  },
  {
    category: 'Benchmarks & Multimodal Biomedical KGs',
    items: [
      {
        title: 'OptimusKG: Unifying Biomedical Knowledge in a Modern Multimodal Graph',
        url: 'https://optimuskg.ai/',
        summary: 'arXiv:2604.27269 & Harvard MIMS repository (github.com/mims-harvard/OptimusKG) for unified multimodal biological graph reasoning.'
      },
      {
        title: 'KG-LLM-Bench & TreeTag',
        url: 'https://github.com/valleyofdawn/TreeTag',
        summary: 'Scalable benchmark for evaluating LLM reasoning on textualized knowledge graphs and hierarchical entity tagging.'
      }
    ]
  },
  {
    category: 'Graph ML, GNN + LLM & PyTorch Geometric',
    items: [
      {
        title: 'Stanford CS224W: Machine Learning with Graphs & Lecture 16 (GNN+LLM)',
        url: 'https://web.stanford.edu/class/cs224w/slides/Lecture16.pdf',
        summary: 'Foundational GNN/GCN link prediction architectures and hybrid GNN+LLM confidence reweighting methodologies.'
      },
      {
        title: 'PyTorch Geometric (PyG) LLM Examples & NVIDIA NGC Containers',
        url: 'https://github.com/pyg-team/pytorch_geometric/tree/master/examples/llm',
        summary: 'Production GNN + LLM implementations and NVIDIA Marlowe GPU container workflows for large-scale link prediction.'
      }
    ]
  },
  {
    category: 'Agentic AI for Graph Development (Brian O’Keefe, Amazon Neptune)',
    items: [
      {
        title: 'Neptune Prototyping with Agents Repository',
        url: 'https://github.com/aws-samples/amazon-neptune-samples/tree/master/neptune-prototyping-with-agents',
        summary: 'Reference agentic workflows for autonomous schema generation, data ingestion, query synthesis, and complex graph validation.'
      },
      {
        title: 'Building a Graph POC Using Agents: 5-Part Case Study Series',
        url: 'https://builder.aws.com/post/3Bir7VVjyMUnuLsq3vhk64GeRnt_p/stop-dreading-the-data-model-ai-agents-make-graph-development-on-amazon-neptune-fun',
        summary: 'Covers Part 1 (Setup), Part 2 (Data Model), Part 3 (Create Data), Part 4 (Create Queries), and Part 5 (Complex Scenarios).'
      }
    ]
  }
];
