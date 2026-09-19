select
    trust_id,
    school_id,
    school_classification,
    survey_period,
    question_code,
    eligible_submission_count,
    answered_response_count,
    missing_response_count,
    adverse_response_count,
    adverse_response_rate
from {{ ref('mart_school_wellbeing_trend') }}
where (adverse_response_rate is not null and (adverse_response_rate < 0 or adverse_response_rate > 1))
   or (adverse_response_count is not null and adverse_response_count > answered_response_count)
   or eligible_submission_count < 0
   or answered_response_count < 0
   or missing_response_count < 0
