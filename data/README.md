# School Wellbeing Source Data

## Local files

| File | Purpose | SHA-256 |
|---|---|---|
| `school-survey-2018-19-1.csv` | Individual survey-response source | `c17d965e5b1cc6068b43250f495c0c1f3fd39e0d5818d3f801d67bd86637a82e` |
| `headline-report-2018-19-2.pdf` | Published headline context | `eadfe3d5eb0ed2180c1fdbe3324e97ddde02528ce28c45279209da5a1558de85` |

Source: [School Student Health and Wellbeing on Kaggle](https://www.kaggle.com/datasets/thedevastator/school-student-health-and-wellbeing).

The Kaggle page labels the license as “Other” and attributes an upstream source. Do not redistribute the CSV or derived row-level data until the downloaded terms and upstream permissions have been checked. Raw files are intentionally ignored by Git.

## Observed structure

- The CSV has 569 columns and 21,955 rows after its ordinary CSV header.
- The first of those rows is a semantic subheader containing the real item labels; it is not a respondent.
- The usable source grain is therefore 21,954 individual survey responses.
- All rows have the expected width of 569 columns.
- `Individaul ID` (source spelling) is populated and unique across the 21,954 response rows.
- Every row has local authority `Leeds`.
- The source contains 11 school-classification values and 11 year-group values.
- The file does not contain a source school identifier. Any `trust_id` or `school_id` in the demo must be explicitly fictional.
- The headline PDF reports 17,397 responses from 188 schools, which does not reconcile directly to the CSV row count. Treat it as contextual publication material, not a manifest for this file.

## Header reconstruction

The exported file uses a two-level spreadsheet header:

1. CSV row 1 contains broad question groups and many `Unnamed: n` placeholders.
2. CSV row 2 contains the actual field or answer-option label.
3. Responses begin on CSV row 3.

The adapter must combine both header rows into stable snake-case field names and retain:

- original zero-based column position;
- broad question label;
- item label;
- normalized field name;
- response value.

Do not use the generated `Unnamed: n` values as business field names.

## Recommended MVP fields

Start with a narrow, explainable subset rather than ingesting all 569 answers into curated models.

This matches the dataset publisher's suggested workflow: understand and clean the columns, use summary statistics, visualize patterns, and interpret results in context. The stated research areas map to three separate analytical domains:

- physical, social-emotional, and mental wellbeing;
- safety and attendance;
- reported learning about British Values.

Keep these domains separate in the semantic layer rather than constructing a single wellbeing score.

### Routing and cohort

| Column | Item |
|---:|---|
| 1 | Individual ID - raw lineage only; pseudonymize before `CORE` |
| 2 | School classification |
| 4 | Year group |
| 5 | Gender - optional protected characteristic; aggregate only |
| 8 | Disability - optional protected characteristic; aggregate only |

Local authority at column 3 may be retained as source provenance, but it has only one observed value (`Leeds`).

### Wellbeing indicators

| Column | Item |
|---:|---|
| 293 | Sad or upset |
| 294 | Lonely |
| 295 | Confident |
| 296 | Stressed or anxious |
| 297 | Happy |
| 298 | Bad tempered or angry |
| 303 | Happiness with number of good friends |
| 304 | Frequency of bullying in or around school/college |
| 400 | Belonging to the school/college community |
| 401 | School/college helps when worried or having a problem |
| 402 | Enjoyment of school/college |
| 403 | School/college is welcoming and caring |
| 406 | Relationship with school/college staff |
| 407 | Safety in school/college toilets |
| 408 | Safety travelling to/from school/college |
| 409 | Safety during lessons |
| 410 | Safety at school/college outside lessons |
| 530 | School/college encouragement of a healthy lifestyle |

Columns 293-304 and 400-410 have about 18,000 non-null responses, with roughly 3,900 blanks caused by questionnaire routing. Missing means “not asked/not applicable/unknown”; it must never be converted to a negative answer.

Columns 376-380 contain only 66 responses and appear to be an alternate questionnaire path. Exclude them from the MVP until that cohort is understood.

## Fields excluded from the MVP

The source includes sexual identity, ethnicity, free-school-meal status, disability, substance use, sexual behaviour, bereavement, self-harm education, domestic abuse, exploitation, and other safeguarding topics.

Default policy:

- Do not expose row-level responses in the dashboard.
- Do not create individual operational follow-up lists from this historical anonymous dataset.
- Do not ingest free text into curated models.
- Do not include sexual behaviour, substance use, bereavement, exploitation, or similarly sensitive fields in the first vertical slice.
- Add a field only with a documented product question, access rule, cohort threshold, and interpretation.

## Demo transformations

The source provides neither tenant identifiers nor submission timestamps. The adapter may add:

- deterministic fictional `trust_id` and `school_id` assignments;
- fictional survey-period and submission timestamps;
- immutable change-envelope metadata;
- simulated corrections, duplicate deliveries, late arrivals, and withdrawals.

Every added field must be marked `provenance = "generated_for_demo"` in the data dictionary or event envelope.

Support signals must be aggregated, transparent, and non-diagnostic. Example rules suitable for demonstration include:

- stress/anxiety reported `Most days` or `Every day`;
- happiness reported `Rarely` or `Never`;
- bullying reported weekly or more often;
- a safety location reported `Unsafe` or `Very unsafe`;
- disagreement that school helps when the respondent is worried.

Store the source answer, rule version, numerator, denominator, and suppressed status so every metric can be audited. Never describe a support signal as a diagnosis, safeguarding determination, or recommendation about an individual.

## Later analytical domains

After the MVP is reliable, add two independently documented marts:

- Attendance: columns 411-427 cover absence from school or missed lessons and reported reasons. Metrics must be described as self-reported responses, not verified attendance records.
- British Values: columns 432-436 cover reported information about rights, respect, democracy, rules/law, and different faiths/beliefs. Keep these measures separate from health, safety, and support signals.

Each mart must report eligible responses, answered responses, missing/not-asked responses, numerator, percentage, and suppression status.

## Initial reconciliation values

The first adapter test should assert:

```text
physical CSV rows after ordinary header       21,955
semantic subheader rows                            1
expected individual response rows             21,954
expected distinct nonblank source IDs          21,954
expected local-authority values                     1
expected local-authority value                  Leeds
```

These values are tied to the checksums above and must be updated deliberately if the source files change.
