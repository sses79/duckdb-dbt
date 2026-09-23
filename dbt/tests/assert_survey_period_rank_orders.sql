-- Returns zero rows when survey_period_rank orders periods correctly.
-- The first branch positions every literal period and fails if any lands out of order;
-- the second fails if any distinct survey_period in fct_wellbeing_response has no rank.
with ranked as (
    select
        period,
        expected_pos,
        row_number() over (order by {{ survey_period_rank('period') }}) as actual_pos
    from (values
        (1, '2018-autumn'),
        (2, '2019-winter'),
        (3, '2019-spring'),
        (4, '2019-summer'),
        (5, '2019-autumn'),
        (6, '2019-monsoon'),
        (7, '2020-winter')
    ) as periods(expected_pos, period)
)
select period
from ranked
where actual_pos <> expected_pos

union all

select survey_period
from (
    select distinct survey_period
    from {{ ref('fct_wellbeing_response') }}
)
where {{ survey_period_rank('survey_period') }} is null
