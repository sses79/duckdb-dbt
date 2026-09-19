select
    trust_id,
    school_id,
    school_classification,
    survey_period,
    question_code
from {{ ref('mart_school_wellbeing_trend') }}
where (answered_response_count < 10) <> is_suppressed
   or (is_suppressed and (adverse_response_count is not null or adverse_response_rate is not null))
   or (not is_suppressed and (adverse_response_count is null or adverse_response_rate is null))
