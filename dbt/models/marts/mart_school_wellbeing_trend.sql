with grouped as (
    select
        trust_id,
        school_id,
        school_classification,
        survey_period,
        question_code,
        category,
        count(*)::integer as eligible_submission_count,
        count(*) filter (where is_answered)::integer as answered_response_count,
        count(*) filter (where not is_answered)::integer as missing_response_count,
        count(*) filter (where is_adverse)::integer as adverse_response_count
    from {{ ref('fct_wellbeing_response') }}
    group by
        trust_id,
        school_id,
        school_classification,
        survey_period,
        question_code,
        category
)

select
    trust_id,
    school_id,
    school_classification,
    survey_period,
    question_code,
    category,
    eligible_submission_count,
    answered_response_count,
    missing_response_count,
    case
        when answered_response_count < 10 then null
        else adverse_response_count
    end as adverse_response_count,
    case
        when answered_response_count < 10 then null
        else adverse_response_count::double / answered_response_count::double
    end as adverse_response_rate,
    answered_response_count < 10 as is_suppressed
from grouped
