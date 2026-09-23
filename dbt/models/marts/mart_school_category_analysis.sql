with school_level as (
    select
        f.trust_id,
        f.school_id,
        case
            when count(distinct f.school_classification) = 1 then min(f.school_classification)
            else 'Mixed source classifications'
        end as school_classification,
        f.survey_period,
        c.category_code,
        min(c.category_label) as category_label,
        count(distinct f.document_id)::integer as eligible_submission_count,
        count(distinct f.document_id) filter (where f.is_answered)::integer as answering_submission_count,
        count(distinct c.question_code)::integer as indicator_count,
        count(*) filter (where f.is_answered)::integer as answered_question_response_count,
        count(*) filter (where not f.is_answered)::integer as missing_question_response_count,
        count(*) filter (where f.is_adverse)::integer as adverse_question_response_count,
        count(*) filter (where f.is_adverse)::double
            / nullif(count(*) filter (where f.is_answered), 0)::double as adverse_question_response_rate,
        count(*) filter (where not f.is_answered)::double
            / nullif(
                count(*) filter (where f.is_answered)
                + count(*) filter (where not f.is_answered),
                0
            )::double as missing_question_response_rate,
        count(distinct f.document_id) filter (where f.is_answered) < 10 as is_suppressed
    from {{ ref('fct_wellbeing_response') }} as f
    join {{ ref('indicator_catalog') }} as c
        on f.question_code = c.question_code
    group by
        f.trust_id,
        f.school_id,
        f.survey_period,
        c.category_code
),

school_totals as (
    select
        trust_id,
        school_id,
        school_classification,
        survey_period,
        category_code,
        category_label,
        eligible_submission_count,
        answering_submission_count,
        indicator_count,
        answered_question_response_count,
        missing_question_response_count,
        is_suppressed,
        case
            when is_suppressed then null
            else adverse_question_response_count
        end as adverse_question_response_count,
        case
            when is_suppressed then null
            else round(adverse_question_response_rate, 4)
        end as adverse_question_response_rate,
        case
            when is_suppressed then null
            else round(missing_question_response_rate, 4)
        end as missing_question_response_rate
    from school_level
),

trust_level as (
    select
        f.trust_id,
        f.survey_period,
        c.category_code,
        count(distinct f.document_id) filter (where f.is_answered)::integer as trust_answering_submission_count,
        count(*) filter (where f.is_answered)::integer as trust_answered_question_response_count,
        count(*) filter (where f.is_adverse)::integer as trust_adverse_question_response_count,
        count(*) filter (where f.is_adverse)::double
            / nullif(count(*) filter (where f.is_answered), 0)::double as trust_adverse_question_response_rate
    from {{ ref('fct_wellbeing_response') }} as f
    join {{ ref('indicator_catalog') }} as c
        on f.question_code = c.question_code
    group by
        f.trust_id,
        f.survey_period,
        c.category_code
),

trust_totals as (
    select
        trust_id,
        survey_period,
        category_code,
        trust_answering_submission_count,
        trust_answered_question_response_count,
        case
            when trust_answering_submission_count < 10 then null
            else trust_adverse_question_response_count
        end as trust_adverse_question_response_count,
        case
            when trust_answering_submission_count < 10 then null
            else round(trust_adverse_question_response_rate, 4)
        end as trust_adverse_question_response_rate
    from trust_level
),

with_previous as (
    select
        s.trust_id,
        s.school_id,
        s.school_classification,
        s.survey_period,
        s.category_code,
        s.category_label,
        s.eligible_submission_count,
        s.answering_submission_count,
        s.indicator_count,
        s.answered_question_response_count,
        s.missing_question_response_count,
        s.is_suppressed,
        s.adverse_question_response_count,
        s.adverse_question_response_rate,
        s.missing_question_response_rate,
        t.trust_answering_submission_count,
        t.trust_answered_question_response_count,
        t.trust_adverse_question_response_count,
        t.trust_adverse_question_response_rate,
        lag(s.adverse_question_response_count) over (
            partition by s.trust_id, s.school_id, s.category_code
            order by {{ survey_period_rank('s.survey_period') }}
        ) as previous_adverse_question_response_count,
        lag(s.answered_question_response_count) over (
            partition by s.trust_id, s.school_id, s.category_code
            order by {{ survey_period_rank('s.survey_period') }}
        ) as previous_answered_question_response_count,
        lag(s.adverse_question_response_rate) over (
            partition by s.trust_id, s.school_id, s.category_code
            order by {{ survey_period_rank('s.survey_period') }}
        ) as previous_adverse_question_response_rate
    from school_totals as s
    join trust_totals as t
        on s.trust_id = t.trust_id
        and s.survey_period = t.survey_period
        and s.category_code = t.category_code
)

select
    trust_id,
    school_id,
    school_classification,
    survey_period,
    category_code,
    category_label,
    eligible_submission_count,
    answering_submission_count,
    indicator_count,
    answered_question_response_count,
    missing_question_response_count,
    is_suppressed,
    adverse_question_response_count,
    adverse_question_response_rate,
    missing_question_response_rate,
    trust_answering_submission_count,
    trust_answered_question_response_count,
    trust_adverse_question_response_count,
    trust_adverse_question_response_rate,
    previous_adverse_question_response_count,
    previous_answered_question_response_count,
    previous_adverse_question_response_rate,
    case
        when adverse_question_response_rate is null
            or previous_adverse_question_response_rate is null then null
        else round((adverse_question_response_rate - previous_adverse_question_response_rate) * 100, 2)
    end as period_change_pp,
    case
        when adverse_question_response_rate is null
            or trust_adverse_question_response_rate is null then null
        else round((adverse_question_response_rate - trust_adverse_question_response_rate) * 100, 2)
    end as trust_gap_pp
from with_previous
