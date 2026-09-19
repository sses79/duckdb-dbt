select
    c.document_id,
    c.event_id,
    c.trust_id,
    c.school_id,
    c.school_classification,
    c.year_group,
    c.local_authority,
    c.survey_period,
    c.source_version,
    c.source_updated_at,
    q.question_code,
    nullif(json_extract_string(c.answers, '$.' || q.question_code), '') as answer_label
from {{ ref('int_wellbeing_submission_current') }} as c
cross join (
    select distinct question_code
    from {{ ref('indicator_answer_catalog') }}
) as q
