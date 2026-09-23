with indicator_mart as (
    select
        'mart_school_indicator_analysis' as mart_name,
        i.trust_id,
        i.school_id,
        i.survey_period,
        i.category_code
    from {{ ref('mart_school_indicator_analysis') }} as i
    where i.is_suppressed
        and (
            i.adverse_response_count is not null
            or i.adverse_response_rate is not null
            or i.missing_response_rate is not null
            or i.period_change_pp is not null
            or i.trust_gap_pp is not null
        )
),

category_mart as (
    select
        'mart_school_category_analysis' as mart_name,
        c.trust_id,
        c.school_id,
        c.survey_period,
        c.category_code
    from {{ ref('mart_school_category_analysis') }} as c
    where c.is_suppressed
        and (
            c.adverse_question_response_count is not null
            or c.adverse_question_response_rate is not null
            or c.missing_question_response_rate is not null
            or c.period_change_pp is not null
            or c.trust_gap_pp is not null
        )
),

distribution_mart as (
    select
        'mart_question_response_distribution' as mart_name,
        d.trust_id,
        d.school_id,
        d.survey_period,
        d.category_code
    from {{ ref('mart_question_response_distribution') }} as d
    where d.is_suppressed
        and (
            d.response_count is not null
            or d.response_rate is not null
        )
),

support_mart as (
    select
        'mart_support_signal_summary' as mart_name,
        s.trust_id,
        s.school_id,
        s.survey_period,
        s.category_code
    from {{ ref('mart_support_signal_summary') }} as s
    where s.is_suppressed
        and (
            s.adverse_response_count is not null
            or s.adverse_response_rate is not null
            or s.signal_level is not null
        )
),

drivers_mart as (
    select
        'mart_school_change_drivers' as mart_name,
        ch.trust_id,
        ch.school_id,
        ch.survey_period,
        ch.category_code
    from {{ ref('mart_school_change_drivers') }} as ch
    where ch.is_suppressed
        and ch.category_change_contribution_pp is not null
)

select * from indicator_mart
union all
select * from category_mart
union all
select * from distribution_mart
union all
select * from support_mart
union all
select * from drivers_mart
