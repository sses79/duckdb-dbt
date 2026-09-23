with fact_counts as (
    select
        f.trust_id,
        f.school_id,
        f.survey_period,
        f.question_code,
        count(*) filter (where f.is_answered and f.is_adverse) as adverse_count
    from {{ ref('fct_wellbeing_response') }} as f
    group by
        f.trust_id,
        f.school_id,
        f.survey_period,
        f.question_code
)

select
    s.trust_id,
    s.school_id,
    s.survey_period,
    s.question_code,
    s.adverse_response_count,
    fc.adverse_count
from {{ ref('mart_support_signal_summary') }} as s
inner join fact_counts as fc
    on s.trust_id = fc.trust_id
    and s.school_id = fc.school_id
    and s.survey_period = fc.survey_period
    and s.question_code = fc.question_code
where not s.is_suppressed
    and s.adverse_response_count is distinct from fc.adverse_count
