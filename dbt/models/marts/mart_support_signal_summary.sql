with grouped as (
    select
        f.trust_id,
        f.school_id,
        case
            when count(distinct f.school_classification) = 1
                then min(f.school_classification)
            else 'Mixed source classifications'
        end as school_classification,
        f.survey_period,
        f.question_code,
        i.indicator_label,
        i.category_code,
        i.category_label,
        count(*)::integer as eligible_submission_count,
        count(*) filter (where f.is_answered)::integer as answered_response_count,
        count(*) filter (where not f.is_answered)::integer as missing_response_count,
        count(*) filter (where f.is_answered and f.is_adverse)::integer as adverse_count
    from {{ ref('fct_wellbeing_response') }} as f
    inner join {{ ref('indicator_catalog') }} as i
        on f.question_code = i.question_code
    group by
        f.trust_id,
        f.school_id,
        f.survey_period,
        f.question_code,
        i.indicator_label,
        i.category_code,
        i.category_label
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
    'support-signal/1' as rule_version,
    eligible_submission_count,
    answered_response_count,
    missing_response_count,
    answered_response_count < 10 as is_suppressed,
    case
        when answered_response_count < 10 then null
        else adverse_count
    end as adverse_response_count,
    case
        when answered_response_count < 10 then null
        else round(adverse_count::double / answered_response_count::double, 4)
    end as adverse_response_rate,
    case
        when answered_response_count < 10 then null
        when round(adverse_count::double / answered_response_count::double, 4) >= 0.20 then 'elevated'
        when round(adverse_count::double / answered_response_count::double, 4) >= 0.10 then 'watch'
        else 'lower'
    end as signal_level
from grouped
