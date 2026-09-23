with reconciled as (
    select
        trust_id,
        school_id,
        survey_period,
        category_code,
        sum(category_change_contribution_pp) as summed_contribution_pp,
        any_value(category_change_pp) as category_change_pp,
        count(*) as question_count,
        count(category_change_contribution_pp) as non_null_contribution_count
    from {{ ref('mart_school_change_drivers') }}
    group by
        trust_id,
        school_id,
        survey_period,
        category_code
)

select
    trust_id,
    school_id,
    survey_period,
    category_code,
    summed_contribution_pp,
    category_change_pp,
    abs(summed_contribution_pp - category_change_pp) as difference_pp
from reconciled
where category_change_pp is not null
    and non_null_contribution_count = question_count
    and abs(summed_contribution_pp - category_change_pp) > 0.06
