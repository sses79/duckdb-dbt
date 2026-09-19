select
    trust_id,
    school_id,
    school_classification,
    survey_period,
    question_code
from {{ ref('mart_school_wellbeing_trend') }}
group by
    trust_id,
    school_id,
    school_classification,
    survey_period,
    question_code
having count(*) > 1
