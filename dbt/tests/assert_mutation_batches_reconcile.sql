with raw_counts as (
    select
        batch_id,
        count(*) as actual_row_count
    from {{ source('raw', 'wellbeing_submission_events') }}
    group by batch_id
)

select
    expected.batch_id as batch_id
from {{ ref('expected_mutation_batches') }} as expected
inner join raw_counts
    on raw_counts.batch_id = expected.batch_id
where raw_counts.actual_row_count <> expected.expected_row_count
