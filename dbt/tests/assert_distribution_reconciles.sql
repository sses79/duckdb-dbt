with distributed as (
    select
        d.trust_id,
        d.school_id,
        d.survey_period,
        d.question_code,
        sum(d.response_count) as summed_response_count
    from {{ ref('mart_question_response_distribution') }} as d
    where not d.is_suppressed
    group by
        d.trust_id,
        d.school_id,
        d.survey_period,
        d.question_code
)

select
    i.trust_id,
    i.school_id,
    i.survey_period,
    i.question_code,
    i.answered_response_count,
    r.summed_response_count
from {{ ref('mart_school_indicator_analysis') }} as i
inner join distributed as r
    on i.trust_id = r.trust_id
    and i.school_id = r.school_id
    and i.survey_period = r.survey_period
    and i.question_code = r.question_code
where not i.is_suppressed
    and i.answered_response_count is distinct from r.summed_response_count
