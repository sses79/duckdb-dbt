with mart_totals as (
    select
        sum(eligible_submission_count) as eligible_total,
        sum(answered_response_count) as answered_total,
        sum(missing_response_count) as missing_total
    from {{ ref('mart_school_wellbeing_trend') }}
),

fact_totals as (
    select
        count(*) as eligible_total,
        count(*) filter (where is_answered) as answered_total,
        count(*) filter (where not is_answered) as missing_total
    from {{ ref('fct_wellbeing_response') }}
),

row_violations as (
    select
        trust_id,
        school_id,
        school_classification,
        survey_period,
        question_code
    from {{ ref('mart_school_wellbeing_trend') }}
    where answered_response_count + missing_response_count <> eligible_submission_count
),

total_violation as (
    select
        'total_mismatch' as trust_id,
        'total_mismatch' as school_id,
        'total_mismatch' as school_classification,
        'total_mismatch' as survey_period,
        'total_mismatch' as question_code
    from mart_totals
    cross join fact_totals
    where mart_totals.eligible_total <> fact_totals.eligible_total
       or mart_totals.answered_total <> fact_totals.answered_total
       or mart_totals.missing_total <> fact_totals.missing_total
)

select * from row_violations
union all
select * from total_violation
