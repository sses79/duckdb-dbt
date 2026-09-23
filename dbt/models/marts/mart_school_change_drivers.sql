with contributions as (
    select
        i.trust_id,
        i.school_id,
        i.school_classification,
        i.survey_period,
        i.category_code,
        c.category_label,
        i.question_code,
        i.indicator_label,
        i.interpretation_note,
        i.eligible_submission_count,
        (i.is_suppressed or c.is_suppressed) as is_suppressed,
        i.adverse_response_rate,
        i.previous_adverse_response_rate,
        i.period_change_pp as indicator_change_pp,
        c.period_change_pp as category_change_pp,
        case
            when i.is_suppressed
                or c.is_suppressed
                or i.adverse_response_count is null
                or i.previous_adverse_response_count is null
                or c.previous_answered_question_response_count is null
            then null
            else round(
                100 * (
                    i.adverse_response_count / c.answered_question_response_count
                    - i.previous_adverse_response_count / c.previous_answered_question_response_count
                ),
                2
            )
        end as category_change_contribution_pp
    from {{ ref('mart_school_indicator_analysis') }} as i
    inner join {{ ref('mart_school_category_analysis') }} as c
        on i.trust_id = c.trust_id
        and i.school_id = c.school_id
        and i.survey_period = c.survey_period
        and i.category_code = c.category_code
)

select
    trust_id,
    school_id,
    school_classification,
    survey_period,
    category_code,
    category_label,
    question_code,
    indicator_label,
    interpretation_note,
    eligible_submission_count,
    is_suppressed,
    adverse_response_rate,
    previous_adverse_response_rate,
    indicator_change_pp,
    category_change_pp,
    category_change_contribution_pp,
    rank() over (
        partition by trust_id, school_id, survey_period, category_code
        order by abs(category_change_contribution_pp) desc nulls last, question_code
    ) as driver_rank
from contributions
