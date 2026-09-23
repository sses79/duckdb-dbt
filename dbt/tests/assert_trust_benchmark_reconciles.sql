with mart_side as (
    select distinct
        i.trust_id,
        i.survey_period,
        i.question_code,
        i.trust_adverse_response_rate
    from {{ ref('mart_school_indicator_analysis') }} as i
),

fact_side as (
    select
        f.trust_id,
        f.survey_period,
        f.question_code,
        case
            when count(*) filter (where f.is_answered) < 10 then null
            else round(
                count(*) filter (where f.is_answered and f.is_adverse)
                / count(*) filter (where f.is_answered),
                4
            )
        end as trust_adverse_response_rate
    from {{ ref('fct_wellbeing_response') }} as f
    group by
        f.trust_id,
        f.survey_period,
        f.question_code
),

mart_only as (
    select
        m.trust_id,
        m.survey_period,
        m.question_code,
        m.trust_adverse_response_rate
    from mart_side as m
    except
    select
        d.trust_id,
        d.survey_period,
        d.question_code,
        d.trust_adverse_response_rate
    from fact_side as d
),

fact_only as (
    select
        d.trust_id,
        d.survey_period,
        d.question_code,
        d.trust_adverse_response_rate
    from fact_side as d
    except
    select
        m.trust_id,
        m.survey_period,
        m.question_code,
        m.trust_adverse_response_rate
    from mart_side as m
)

select * from mart_only
union all
select * from fact_only
