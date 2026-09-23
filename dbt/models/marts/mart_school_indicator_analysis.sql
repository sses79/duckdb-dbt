with school_grouped as (
    select
        trust_id,
        school_id,
        survey_period,
        question_code,
        case
            when count(distinct school_classification) > 1 then 'Mixed source classifications'
            else min(school_classification)
        end as school_classification,
        count(*)::integer as eligible_submission_count,
        count(*) filter (where is_answered)::integer as answered_response_count,
        count(*) filter (where not is_answered)::integer as missing_response_count,
        count(*) filter (where is_adverse)::integer as adverse_response_count
    from {{ ref('fct_wellbeing_response') }}
    group by
        trust_id,
        school_id,
        survey_period,
        question_code
),

trust_grouped as (
    select
        trust_id,
        survey_period,
        question_code,
        sum(answered_response_count)::integer as trust_answered_response_count,
        sum(adverse_response_count)::integer as trust_adverse_response_count
    from school_grouped
    group by
        trust_id,
        survey_period,
        question_code
),

school_metrics as (
    select
        s.trust_id,
        s.school_id,
        s.school_classification,
        s.survey_period,
        s.question_code,
        s.eligible_submission_count,
        s.answered_response_count,
        s.missing_response_count,
        s.answered_response_count < 10 as is_suppressed,
        case
            when s.answered_response_count < 10 then null
            else s.adverse_response_count
        end as adverse_response_count,
        case
            when s.answered_response_count < 10 then null
            else round(s.adverse_response_count::double / s.answered_response_count::double, 4)
        end as adverse_response_rate,
        case
            when s.answered_response_count < 10 then null
            else round(s.missing_response_count::double / s.eligible_submission_count::double, 4)
        end as missing_response_rate
    from school_grouped as s
),

school_with_previous as (
    select
        sm.*,
        lag(sm.adverse_response_count) over (
            partition by sm.trust_id, sm.school_id, sm.question_code
            order by {{ survey_period_rank('sm.survey_period') }}
        ) as previous_adverse_response_count,
        lag(sm.answered_response_count) over (
            partition by sm.trust_id, sm.school_id, sm.question_code
            order by {{ survey_period_rank('sm.survey_period') }}
        ) as previous_answered_response_count,
        lag(sm.adverse_response_rate) over (
            partition by sm.trust_id, sm.school_id, sm.question_code
            order by {{ survey_period_rank('sm.survey_period') }}
        ) as previous_adverse_response_rate
    from school_metrics as sm
),

trust_metrics as (
    select
        t.trust_id,
        t.survey_period,
        t.question_code,
        case
            when t.trust_answered_response_count < 10 then null
            else t.trust_answered_response_count
        end as trust_answered_response_count,
        case
            when t.trust_answered_response_count < 10 then null
            else t.trust_adverse_response_count
        end as trust_adverse_response_count,
        case
            when t.trust_answered_response_count < 10 then null
            else round(t.trust_adverse_response_count::double / t.trust_answered_response_count::double, 4)
        end as trust_adverse_response_rate
    from trust_grouped as t
),

joined as (
    select
        s.trust_id,
        s.school_id,
        s.school_classification,
        s.survey_period,
        s.question_code,
        c.indicator_label,
        c.category_code,
        c.category_label,
        c.direction,
        c.interpretation_note,
        s.eligible_submission_count,
        s.answered_response_count,
        s.missing_response_count,
        s.is_suppressed,
        s.adverse_response_count,
        s.adverse_response_rate,
        s.missing_response_rate,
        t.trust_answered_response_count,
        t.trust_adverse_response_count,
        t.trust_adverse_response_rate,
        s.previous_adverse_response_count,
        s.previous_answered_response_count,
        s.previous_adverse_response_rate,
        case
            when s.adverse_response_rate is null or s.previous_adverse_response_rate is null then null
            else round(100 * (s.adverse_response_rate - s.previous_adverse_response_rate), 2)
        end as period_change_pp,
        case
            when s.adverse_response_rate is null or t.trust_adverse_response_rate is null then null
            else round(100 * (s.adverse_response_rate - t.trust_adverse_response_rate), 2)
        end as trust_gap_pp,
        case
            when s.is_suppressed then 'suppressed'
            when s.missing_response_rate >= 0.20 then 'limited'
            else 'adequate'
        end as coverage_status
    from school_with_previous as s
    inner join trust_metrics as t
        on s.trust_id = t.trust_id
        and s.survey_period = t.survey_period
        and s.question_code = t.question_code
    inner join {{ ref('indicator_catalog') }} as c
        on s.question_code = c.question_code
),

final as (
    select
        j.*,
        case
            when j.adverse_response_rate is null or j.previous_adverse_response_rate is null then 'no_comparison'
            when j.period_change_pp >= 1 then 'worsening'
            when j.period_change_pp <= -1 then 'improving'
            else 'stable'
        end as movement_status
    from joined as j
)

select
    trust_id,
    school_id,
    school_classification,
    survey_period,
    question_code,
    indicator_label,
    category_code,
    category_label,
    direction,
    interpretation_note,
    eligible_submission_count,
    answered_response_count,
    missing_response_count,
    is_suppressed,
    adverse_response_count,
    adverse_response_rate,
    missing_response_rate,
    trust_answered_response_count,
    trust_adverse_response_count,
    trust_adverse_response_rate,
    previous_adverse_response_count,
    previous_answered_response_count,
    previous_adverse_response_rate,
    period_change_pp,
    trust_gap_pp,
    coverage_status,
    movement_status
from final
