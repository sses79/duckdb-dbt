with source as (
    select * from {{ source('raw', 'wellbeing_submission_events') }}
),

deduplicated as (
    select
        event_id,
        document_id,
        operation,
        source_version,
        source_updated_at,
        extracted_at,
        schema_version,
        batch_id,
        region,
        json_extract_string(payload, '$.trust_id') as trust_id,
        json_extract_string(payload, '$.school_id') as school_id,
        json_extract_string(payload, '$.school_classification') as school_classification,
        json_extract_string(payload, '$.year_group') as year_group,
        json_extract_string(payload, '$.local_authority') as local_authority,
        json_extract_string(payload, '$.survey_period') as survey_period,
        json_extract(payload, '$.answers') as answers,
        source_file,
        source_file_row_number,
        loaded_at
    from source
    qualify row_number() over (
        partition by event_id
        order by loaded_at, batch_id, source_file_row_number
    ) = 1
)

select * from deduplicated
